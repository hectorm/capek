import { Agent as HttpAgent, request as httpRequest, STATUS_CODES } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import process from "node:process";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { HttpHeaders } from "#layers/core/shared/http";
import { allowedHost, HostNotAllowedError, parseHostList } from "#layers/core/server/lib/network";
import { HTTP_REDACTED_VALUE } from "#layers/core/shared/http";

export interface Endpoint {
  url: string;
  apiKey?: string;
  headers: HttpHeaders;
}

export type EndpointInit = Pick<RequestInit, "method" | "headers" | "signal"> & {
  body?: string;
  redirect?: "error" | "follow";
};

const ERROR_TEXT_MAX_CHARS = 1000;
const ERROR_BODY_MAX_BYTES = 16_384;

const MAX_REDIRECTS = 3;
const CONNECT_TIMEOUT_MS = 10_000;
const HEADERS_TIMEOUT_MS = 300_000;
const BODY_TIMEOUT_MS = 300_000;
const KEEP_ALIVE_TIMEOUT_MS = 4_000;

const USER_AGENT = "Capek";

const RESERVED_HEADERS = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const ErrorMessageSchema = z.string().trim().min(1);
const ApiErrorSchema = z.union([
  z.object({ error: z.object({ message: ErrorMessageSchema }) }).transform((body) => body.error.message),
  z.object({ error: ErrorMessageSchema }).transform((body) => body.error),
  z.object({ message: ErrorMessageSchema }).transform((body) => body.message),
  z.object({ detail: ErrorMessageSchema }).transform((body) => body.detail),
]);

const agents = new Map<string, HttpAgent>();

const proxyOf = (protocol: string, hostname: string, port: string): string | undefined => {
  const env = (...names: string[]): string => names.map((name) => process.env[name]).find(Boolean) ?? "";
  const proxy = protocol === "https:" ? env("HTTPS_PROXY", "https_proxy") : env("HTTP_PROXY", "http_proxy");
  if (!proxy) {
    return undefined;
  }
  const noProxy = parseHostList(`localhost, 127.0.0.0/8, ::1, ${env("NO_PROXY", "no_proxy")}`, { ignoreInvalid: true });
  if (noProxy.includesName(hostname, port) || noProxy.includesAddress(hostname, port)) {
    return undefined;
  }

  const url = URL.parse(/^[a-z][a-z\d+.-]*:\/\//i.test(proxy) ? proxy : `http://${proxy}`);
  if (!url || !/^https?:$/.test(url.protocol)) {
    throw new Error("The proxy of the environment has to be an HTTP or HTTPS URL");
  }
  return url.href;
};

const agentOf = (protocol: string, proxy = ""): HttpAgent => {
  const key = `${protocol} ${proxy}`;
  let agent = agents.get(key);
  if (!agent) {
    const options = {
      keepAlive: true,
      timeout: KEEP_ALIVE_TIMEOUT_MS,
      proxyEnv: proxy ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy } : undefined,
    };
    agent = protocol === "https:" ? new HttpsAgent(options) : new HttpAgent(options);
    agents.set(key, agent);
  }
  return agent;
};

const toResponse = (message: IncomingMessage): Response => {
  const status = message.statusCode ?? 200;

  const headers = new Headers();
  for (const [name, values] of Object.entries(message.headersDistinct)) {
    for (const value of values ?? []) {
      headers.append(name, value);
    }
  }

  const body = [204, 205, 304].includes(status) ? null : (Readable.toWeb(message) as ReadableStream<Uint8Array>);
  if (!body) {
    message.destroy();
  }
  return new Response(body, { status, statusText: message.statusMessage, headers });
};

const send = (
  target: URL,
  { method = "GET", headers, body, signal }: EndpointInit,
  connection: { agent: HttpAgent; lookup: LookupFunction },
): Promise<Response> => {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let message: IncomingMessage | undefined;
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
      target,
      {
        ...connection,
        method,
        headers: {
          "user-agent": USER_AGENT,
          ...Object.fromEntries([...new Headers(headers)].filter(([name]) => !RESERVED_HEADERS.has(name))),
          "accept-encoding": "identity",
        },
        timeout: CONNECT_TIMEOUT_MS,
      },
      (incoming) => {
        clearTimeout(headersTimer);
        message = incoming;
        try {
          resolve(toResponse(message));
        } catch (error) {
          message.destroy();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );

    const fail = (error: Error): void => {
      (message ?? request).destroy(error);
      reject(error);
    };

    const connectTimer = setTimeout(() => {
      fail(new Error("The endpoint did not accept the connection in time"));
    }, CONNECT_TIMEOUT_MS);
    const headersTimer = setTimeout(() => {
      fail(new Error("The endpoint did not answer in time"));
    }, HEADERS_TIMEOUT_MS);
    const connected = (): void => {
      clearTimeout(connectTimer);
      request.setTimeout(BODY_TIMEOUT_MS);
    };
    request.on("socket", (socket) => {
      if (socket.connecting) {
        socket.once(target.protocol === "https:" ? "secureConnect" : "connect", connected);
      } else {
        connected();
      }
    });

    const abort = (): void => {
      fail(signal?.reason as Error);
    };
    signal?.addEventListener("abort", abort, { once: true });
    request.on("close", () => {
      clearTimeout(connectTimer);
      clearTimeout(headersTimer);
      signal?.removeEventListener("abort", abort);
    });

    request.on("timeout", () => {
      fail(new Error("The endpoint did not answer in time"));
    });
    request.on("error", reject);
    request.on("upgrade", (_message, socket) => {
      socket.destroy();
      reject(new Error("The endpoint switched to another protocol"));
    });
    request.end(body);
  });
};

const sendAllowed = async (target: URL, init: EndpointInit): Promise<Response> => {
  if (!/^https?:$/.test(target.protocol) || target.username || target.password) {
    throw new Error("The URL must use HTTP or HTTPS without credentials");
  }

  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  const host = allowedHost(target.hostname, port);
  const proxy = proxyOf(target.protocol, host.name, port);
  if (proxy && !host.nameAllowed) {
    await host.resolve(init.signal).catch((error: unknown) => {
      if (error instanceof HostNotAllowedError || init.signal?.aborted) {
        throw error;
      }
    });
  }
  return send(target, init, { agent: agentOf(target.protocol, proxy), lookup: host.lookup });
};

// Requests an endpoint connecting only to public IP addresses or allowed hosts
export const fetchEndpoint = async (url: string | URL, init: EndpointInit = {}): Promise<Response> => {
  let target = new URL(url);
  let hopInit = init;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await sendAllowed(target, hopInit);
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    await response.body?.cancel();
    const location = response.headers.get("Location");
    if (init.redirect !== "follow" || location === null) {
      const shown = location?.slice(0, ERROR_TEXT_MAX_CHARS);
      throw new Error(`The endpoint redirects${shown ? ` to "${shown}"` : ""}, its URL has to be changed`);
    }
    target = new URL(location, target);
    // Redirects are followed with plain GET requests, without the headers or body of the first one
    hopInit = { signal: init.signal };
  }
  throw new Error("The endpoint redirects too many times");
};

// Fails the body of a response once it is larger than a number of bytes
export const limitResponse = (response: Response, maxBytes: number, message: string): Response => {
  if (!response.body) {
    return response;
  }
  let bytes = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          throw new Error(message);
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, response);
};

// Reads the start of the body of a failed response as text
export const readErrorBody = async (body: AsyncIterable<Uint8Array> | null): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for await (const chunk of body ?? []) {
    text += decoder.decode(chunk.subarray(0, ERROR_BODY_MAX_BYTES - bytes), { stream: true });
    bytes += chunk.byteLength;
    if (bytes >= ERROR_BODY_MAX_BYTES) {
      break;
    }
  }
  return text + decoder.decode();
};

// Describes a failed response without exposing bodies other than API errors
export const readErrorMessage = async (response: Response, body?: string): Promise<string> => {
  body ??= await readErrorBody(response.body);

  let message: string | undefined;
  try {
    message = ApiErrorSchema.safeParse(JSON.parse(body)).data;
  } catch {
    // The body is not JSON
  }

  const status = `${String(response.status)} ${STATUS_CODES[response.status] ?? ""}`.trim();
  if (!message) {
    return status;
  }
  return message.length > ERROR_TEXT_MAX_CHARS
    ? `${status}: ${message.slice(0, ERROR_TEXT_MAX_CHARS).toWellFormed()}...`
    : `${status}: ${message}`;
};

// Completes what a client sends of an endpoint with the stored one, whose secrets are only taken for the same URL
export const unredactEndpoint = (incoming: Partial<Endpoint>, stored: Endpoint | undefined): Required<Endpoint> => {
  // Stored secrets that the endpoint keeps
  let kept = 0;
  const unredact = (value: string | undefined, storedValue: string | undefined): string => {
    if (value !== undefined && value !== HTTP_REDACTED_VALUE) {
      return value;
    }
    kept += storedValue ? 1 : 0;
    return storedValue ?? "";
  };

  const url = incoming.url ?? stored?.url ?? "";
  const apiKey = unredact(incoming.apiKey, stored?.apiKey);
  // Headers that were not sent are the stored ones, all left hidden
  const hidden = stored?.headers.map((h) => ({ ...h, value: HTTP_REDACTED_VALUE })) ?? [];
  const headers = (incoming.headers ?? hidden).map((h) => {
    return { ...h, value: unredact(h.value, stored?.headers.find((s) => s.name === h.name)?.value) };
  });

  if (kept > 0 && url !== stored?.url) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The hidden secrets have to be entered again to change the URL",
    });
  }

  return { url, apiKey, headers };
};
