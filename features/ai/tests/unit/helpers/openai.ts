import { vi } from "vitest";

import type { LlmProviderApiType } from "#layers/ai/shared/llmProvider";
import { OpenAIClient } from "#layers/ai/server/lib/openai/client";
import { OpenAIStreamProcessor } from "#layers/ai/server/lib/openai/stream";
import { SSEProcessor } from "#layers/ai/server/lib/sse";

// The requests of the client are answered by the given function and kept to check them
export const createClient = (respond: () => Response, apiType?: LlmProviderApiType) => {
  const sent: Record<string, unknown>[] = [];
  const paths: string[] = [];
  const headers: Headers[] = [];
  vi.stubGlobal("fetch", (url: URL, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string) as Record<string, unknown>);
    paths.push(url.pathname);
    headers.push(new Headers(init.headers));
    return Promise.resolve(respond());
  });
  const client = new OpenAIClient({
    apiUrl: "http://llm.localhost/v1",
    apiType,
    apiKey: "hunter2",
    model: "reasoner",
  });
  return { client, sent, paths, headers };
};

const encoder = new TextEncoder();

// Events are split in pieces that do not match their boundaries, like those of a network stream
export const streamOf = (events: Record<string, unknown>[]): ReadableStream<Uint8Array> => {
  const bytes = encoder.encode(
    events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
  );
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 50) {
        controller.enqueue(bytes.subarray(offset, offset + 50));
      }
      controller.close();
    },
  });
};

// Reads a translated stream the way the agents do
export const readStream = async (stream: ReadableStream<Uint8Array>) => {
  const processor = new OpenAIStreamProcessor();
  const finishReasons: string[] = [];
  const sseProcessor = new SSEProcessor({
    onEvent: (event) => {
      const chunk = processor.parseChunk(event.data);
      if (chunk) {
        processor.processChunk(chunk);
        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason) {
          finishReasons.push(finishReason);
        }
      }
    },
  });

  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sseProcessor.process(value);
  }
  sseProcessor.flush();

  return { content: processor.getContent(), toolCalls: processor.getToolCalls(), finishReasons };
};
