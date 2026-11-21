import http from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LlmRequest, LlmStreamEvent } from "#layers/ai/shared/llm";
import { LlmClient } from "#layers/ai/server/lib/llm/client";
import { MCPRequestError, request } from "#layers/ai/server/lib/mcp/http";
import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";

const RESPONSE_MAX_BYTES = 10 * 1024 * 1024;
const STREAM_MAX_BYTES = 100 * 1024 * 1024;
const LIMIT_ERROR = `The AI service sent a response larger than ${String(RESPONSE_MAX_BYTES)} bytes`;
const STREAM_LIMIT_ERROR = `The AI service sent a response larger than ${String(STREAM_MAX_BYTES)} bytes`;

const completion: LlmRequest = { input: [{ type: "message", role: "user", content: "Hello" }] };
const apiTypes = ["chat-completions", "responses", "messages"] as const;

describe("AI HTTP responses", () => {
  let server: http.Server;
  let url: string;
  let respond: (res: http.ServerResponse) => void;
  const previousHosts = runtimeConfig.allowedPrivateHosts;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      respond(res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const host = `127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    runtimeConfig.allowedPrivateHosts = host;
    url = `http://${host}`;
  });

  afterAll(async () => {
    runtimeConfig.allowedPrivateHosts = previousHosts;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const models = (bytes: number): string => {
    const empty = '{"data":[{"id":"test"}],"padding":""}';
    return empty.replace('"padding":""', `"padding":"${" ".repeat(bytes - empty.length)}"`);
  };

  it("accepts a model list at the byte limit", async () => {
    respond = (res) => res.end(models(RESPONSE_MAX_BYTES));
    expect(await new LlmClient({ apiUrl: url }).testConnection()).toEqual({ success: true });
  });

  it("rejects a model list one byte over the limit", async () => {
    respond = (res) => res.end(models(RESPONSE_MAX_BYTES + 1));
    expect(await new LlmClient({ apiUrl: url }).testConnection()).toEqual({ success: false, error: LIMIT_ERROR });
  });

  it.each(apiTypes)("cancels an oversized %s JSON response without waiting for its end", async (apiType) => {
    const closed = Promise.withResolvers();
    respond = (res) => {
      res.on("close", () => {
        closed.resolve(undefined);
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      // The open stream makes the client enforce its byte limit as chunks arrive
      res.write('{"padding":"');
      res.write("x".repeat(RESPONSE_MAX_BYTES));
    };
    const client = new LlmClient({ apiUrl: url, apiType });
    await expect(client.completion({ ...completion, stream: false })).rejects.toThrow(LIMIT_ERROR);
    await closed.promise;
  });

  it.each(apiTypes)("bounds the total %s stream across small events", async (apiType) => {
    const closed = Promise.withResolvers();
    const text = "é".repeat(2048);
    const rawEvent = {
      "chat-completions": {
        id: "test",
        object: "chat.completion.chunk",
        created: 0,
        model: "test",
        choices: [{ index: 0, delta: { content: text } }],
      },
      responses: { type: "response.output_text.delta", delta: text },
      messages: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    }[apiType];
    const chunk = `data: ${JSON.stringify(rawEvent)}\n\n`;
    const count = Math.floor(STREAM_MAX_BYTES / Buffer.byteLength(chunk)) + 1;

    respond = (res) => {
      res.on("close", () => {
        closed.resolve(undefined);
      });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      Readable.from(
        (function* () {
          yield Buffer.from(
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          );
          const event = Buffer.from(chunk);
          for (let i = 0; i < count; i++) {
            yield event;
          }
        })(),
      ).pipe(res, { end: false });
    };
    const client = new LlmClient({ apiUrl: url, apiType });
    const stream = (await client.completion({ ...completion, stream: true })) as ReadableStream<LlmStreamEvent>;
    let received = 0;
    await expect(
      stream.pipeTo(
        new WritableStream<LlmStreamEvent>({
          write(event) {
            if (event.type === "response.output_text.delta") {
              received += event.delta.length;
            }
          },
        }),
      ),
    ).rejects.toThrow(STREAM_LIMIT_ERROR);
    expect(received).toBeGreaterThan(RESPONSE_MAX_BYTES);
    // The UTF-8 data exceeds the byte limit while its character count does not
    expect(received).toBeLessThan(STREAM_MAX_BYTES);
    await closed.promise;
  });

  it("propagates cancellation to the provider through the bounded stream", async () => {
    const closed = Promise.withResolvers();
    respond = (res) => {
      res.on("close", () => {
        closed.resolve(undefined);
      });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n');
    };
    const client = new LlmClient({ apiUrl: url, apiType: "responses" });
    const stream = (await client.completion(completion)) as ReadableStream<LlmStreamEvent>;
    const reader = stream.getReader();
    expect((await reader.read()).value).toEqual({ type: "response.output_text.delta", delta: "Hello" });
    await reader.cancel();
    await closed.promise;
  });

  it.each([true, false])(
    "returns a large MCP error promptly (response ended: %s)",
    async (ended) => {
      const closed = Promise.withResolvers();
      respond = (res) => {
        res.on("close", () => {
          closed.resolve(undefined);
        });
        res.writeHead(500, { "Content-Type": "text/html" });
        res.write("x".repeat(65_536));
        if (ended) {
          res.end();
        }
      };
      await expect(request(url, "server/discover", {}, { headers: new Headers(), timeoutMs: 1000 })).rejects.toThrow(
        "MCP request failed: 500 Internal Server Error",
      );
      await closed.promise;
    },
    3000,
  );

  it("preserves the status, code and data of an MCP error", async () => {
    const error = { code: -32022, message: "Unsupported protocol version", data: { supported: ["test"] } };
    respond = (res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error }));
    };
    const result = request(url, "server/discover", {}, { headers: new Headers() });
    await expect(result).rejects.toBeInstanceOf(MCPRequestError);
    await expect(result).rejects.toMatchObject({
      status: 400,
      code: error.code,
      data: error.data,
      message: "MCP request failed: 400 Bad Request: Unsupported protocol version",
    });
  });
});
