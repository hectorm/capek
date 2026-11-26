import { Readable } from "node:stream";

import type { H3Event } from "h3";
import { createError } from "h3";

import type { ServerFeature } from "#layers/core/server/lib/features/define";

export const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;

// Node applies the same default deadline to whole requests
const BODY_DEADLINE_MS = 300_000;
const UPLOAD_IDLE_TIMEOUT_MS = 300_000;

const bodyDeadlines = new WeakMap<object, NodeJS.Timeout>();

// Body limit of a route in bytes
export type BodyLimit = number | ((event: H3Event) => number | Promise<number>);

export type BodyLimits = Readonly<Record<string, BodyLimit>>;

// Non-core features can override body limits only under /api/<feature>/
export const collectBodyLimits = (features: readonly ServerFeature[]): ReadonlyMap<string, BodyLimit> => {
  const limits = new Map<string, BodyLimit>();
  for (const feature of features) {
    for (const [path, limit] of Object.entries(feature.bodyLimits ?? {})) {
      if (feature.name !== "core" && !path.startsWith(`/api/${feature.name}/`)) {
        throw new Error(`Route "${path}" of feature "${feature.name}" must start with "/api/${feature.name}/"`);
      }
      if (limits.has(path)) {
        throw new Error(`Duplicate body limit of route "${path}" in feature "${feature.name}"`);
      }
      limits.set(path, limit);
    }
  }
  return limits;
};

// Only an exact route match gets a custom body limit
export const resolveBodyLimit = async (limits: ReadonlyMap<string, BodyLimit>, event: H3Event): Promise<number> => {
  const limit = limits.get(event.path.split("?", 1)[0] ?? "");
  const bytes = typeof limit === "function" ? await limit(event) : limit;
  return bytes !== undefined && Number.isFinite(bytes) ? bytes : DEFAULT_BODY_LIMIT;
};

export const startBodyDeadline = (event: H3Event, timeout = BODY_DEADLINE_MS): void => {
  const { req: request, res: response } = event.node;
  // In-process requests have no connection to time out
  if (event.web || request.complete) {
    return;
  }

  const timer = setTimeout(() => {
    if (request.complete) {
      return;
    }
    if (response.headersSent) {
      request.destroy();
    } else {
      response.writeHead(408, { Connection: "close" }).end();
    }
  }, timeout).unref();
  bodyDeadlines.set(request, timer);
  request.once("close", () => {
    clearTimeout(timer);
  });
};

// A long upload replaces the deadline of its body with a timeout while no data arrives
export const readUploadBody = (event: H3Event): Readable => {
  clearTimeout(bodyDeadlines.get(event.node.req));
  const body = event.web?.request?.body
    ? Readable.fromWeb(event.web.request.body as Parameters<typeof Readable.fromWeb>[0])
    : event.node.req;
  const chunks = async function* (): AsyncGenerator<Uint8Array> {
    let waiting = true;
    const timer = setTimeout(() => {
      if (waiting) {
        body.destroy(
          createError({
            statusCode: 408,
            message: "Upload timed out",
          }),
        );
      }
    }, UPLOAD_IDLE_TIMEOUT_MS).unref();
    try {
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        waiting = false;
        yield chunk;
        waiting = true;
        timer.refresh();
      }
    } finally {
      clearTimeout(timer);
    }
  };

  return Readable.from(chunks(), {
    objectMode: false,
    highWaterMark: 0,
    destroy(error, callback) {
      body.destroy();
      callback(error);
    },
  });
};
