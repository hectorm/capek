import { vi } from "vitest";

import type { LlmItem, LlmStreamEvent } from "#layers/ai/shared/llm";
import type { LlmProviderApiType } from "#layers/ai/shared/llmProvider";
import { LlmClient } from "#layers/ai/server/lib/llm/client";

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
  const client = new LlmClient({
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
  const bytes = encoder.encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
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
export const readStream = async (stream: ReadableStream<LlmStreamEvent>) => {
  let text = "";
  let output: LlmItem[] = [];

  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value.type === "response.output_text.delta") {
      text += value.delta;
    } else {
      output = value.response.output;
    }
  }

  return { text, output };
};
