import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod/v4";

import { describeError } from "#layers/ai/server/lib/errors";
import { SSEProcessor } from "#layers/ai/server/lib/sse";
import { fetchEndpoint, readBodyStart, readErrorMessage } from "#layers/core/server/lib/http";

const REQUEST_TIMEOUT_MS = 30_000;
const RESPONSE_MAX_BYTES = 10 * 1024 * 1024;
const ERROR_BODY_MAX_BYTES = 16_384;
const STREAM_RETRY_MIN_MS = 1_000;

const JSONRPCErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

const JSONRPCResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  result: z.unknown().optional(),
  error: JSONRPCErrorSchema.optional(),
});

type JSONRPCResponse = z.infer<typeof JSONRPCResponseSchema>;

export interface MCPRequestOptions {
  headers: Headers;
  signal?: AbortSignal;
  timeoutMs?: number;
  resumable?: boolean;
}

interface MCPStream {
  response?: JSONRPCResponse;
  lastEventId: string | null;
  retryMs: number;
}

export class MCPRequestError extends Error {
  public readonly status: number;
  public readonly code: number | null;
  public readonly data: unknown;

  public constructor(message: string, status: number, error?: z.infer<typeof JSONRPCErrorSchema>) {
    super(message);
    this.name = "MCPRequestError";
    this.status = status;
    this.code = error?.code ?? null;
    this.data = error?.data;
  }
}

const parseResponse = (text: string): JSONRPCResponse | null => {
  try {
    const response = JSONRPCResponseSchema.safeParse(JSON.parse(text)).data;
    return response && (response.result !== undefined || response.error !== undefined) ? response : null;
  } catch {
    return null;
  }
};

const send = async (url: string, init: RequestInit): Promise<Response> => {
  const response = await fetchEndpoint(url, init).catch((error: unknown) => {
    throw new Error(describeError(error));
  });

  if (!response.ok) {
    const error = parseResponse(await readBodyStart(response.clone().body, ERROR_BODY_MAX_BYTES))?.error;
    throw new MCPRequestError(`MCP request failed: ${await readErrorMessage(response)}`, response.status, error);
  }
  return response;
};

const post = async (
  url: string,
  message: unknown,
  options: MCPRequestOptions,
  signal: AbortSignal,
): Promise<Response> => {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json, text/event-stream");
  return send(url, { method: "POST", headers, body: JSON.stringify(message), signal });
};

const readBody = async function* (body: ReadableStream<Uint8Array> | null): AsyncGenerator<Uint8Array> {
  let bytes = 0;
  for await (const chunk of body ?? []) {
    bytes += chunk.byteLength;
    if (bytes > RESPONSE_MAX_BYTES) {
      throw new Error(`The MCP server sent a response larger than ${String(RESPONSE_MAX_BYTES)} bytes`);
    }
    yield chunk;
  }
};

const readJsonResponse = async (body: ReadableStream<Uint8Array> | null): Promise<JSONRPCResponse> => {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of readBody(body)) {
    text += decoder.decode(chunk, { stream: true });
  }

  const response = parseResponse(text + decoder.decode());
  if (!response) {
    throw new Error("The MCP server did not send a valid JSON-RPC response");
  }
  return response;
};

const readStream = async (body: ReadableStream<Uint8Array> | null, id: number): Promise<MCPStream> => {
  const stream: MCPStream = { lastEventId: null, retryMs: 0 };
  const sse = new SSEProcessor({
    onEvent: (event) => {
      stream.lastEventId = event.eventId ?? stream.lastEventId;
      const message = parseResponse(event.data);
      if (message?.id === id) {
        stream.response = message;
      }
    },
    onRetry: (retryMs) => {
      stream.retryMs = retryMs;
    },
  });

  for await (const chunk of readBody(body)) {
    sse.process(chunk);
    if (stream.response) {
      return stream;
    }
  }
  sse.flush();
  return stream;
};

const readStreamResponse = async (
  url: string,
  response: Response,
  id: number,
  options: MCPRequestOptions,
  signal: AbortSignal,
): Promise<JSONRPCResponse> => {
  let stream = await readStream(response.body, id);
  let { lastEventId } = stream;
  while (!stream.response) {
    if (!options.resumable || lastEventId === null) {
      throw new Error("The MCP server did not send a valid JSON-RPC response in its stream");
    }
    await sleep(Math.max(stream.retryMs, STREAM_RETRY_MIN_MS), undefined, { signal });

    const headers = new Headers(options.headers);
    headers.set("Accept", "text/event-stream");
    headers.set("Last-Event-ID", lastEventId);
    const resumed = await send(url, { method: "GET", headers, signal }).catch((error: unknown) => {
      throw new Error(`The MCP server did not resume its stream: ${describeError(error)}`);
    });
    stream = await readStream(resumed.body, id);
    lastEventId = stream.lastEventId ?? lastEventId;
  }
  return stream.response;
};

const timeoutSignal = (options: MCPRequestOptions): AbortSignal => {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  return options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
};

let lastRequestId = 0;

export const request = async (
  url: string,
  method: string,
  params: Record<string, unknown>,
  options: MCPRequestOptions,
): Promise<{ result: unknown; headers: Headers }> => {
  const id = ++lastRequestId;
  const signal = timeoutSignal(options);
  const response = await post(url, { jsonrpc: "2.0", id, method, params }, options, signal);

  const { result, error } = response.headers.get("Content-Type")?.includes("text/event-stream")
    ? await readStreamResponse(url, response, id, options, signal)
    : await readJsonResponse(response.body);
  if (error) {
    throw new MCPRequestError(error.message, response.status, error);
  }
  return { result, headers: response.headers };
};

export const notify = async (
  url: string,
  method: string,
  params: Record<string, unknown>,
  options: MCPRequestOptions,
): Promise<void> => {
  const response = await post(url, { jsonrpc: "2.0", method, params }, options, timeoutSignal(options));
  await response.body?.cancel();
};
