import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenAIApiType, OpenAICompletionRequest } from "#layers/ai/shared/openai";
import { OpenAIClient } from "#layers/ai/server/lib/openai/client";
import { fromResponsesResponse, fromResponsesStream, toResponsesRequest } from "#layers/ai/server/lib/openai/responses";
import { OpenAIStreamProcessor } from "#layers/ai/server/lib/openai/stream";
import { SSEProcessor } from "#layers/ai/server/lib/sse";

type SentRequest = Record<string, unknown>;

const request: OpenAICompletionRequest = {
  messages: [{ role: "user", content: "What is the weather in Madrid?" }],
  stream: false,
  tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: {} } } }],
};

const createClient = (respond: () => Response, apiType?: OpenAIApiType) => {
  const sent: SentRequest[] = [];
  const paths: string[] = [];
  vi.stubGlobal("fetch", (url: URL, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string) as SentRequest);
    paths.push(url.pathname);
    return Promise.resolve(respond());
  });
  const client = new OpenAIClient({ apiUrl: "http://llm.localhost/v1", apiType, model: "reasoner" });
  return { client, sent, paths };
};

const encoder = new TextEncoder();

// Events are split in pieces that do not match their boundaries, like those of a network stream
const streamOf = (events: Record<string, unknown>[]): ReadableStream<Uint8Array> => {
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
const readStream = async (stream: ReadableStream<Uint8Array>) => {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai responses", () => {
  it("uses the Responses API of the providers set up with it", async () => {
    const { client, sent, paths } = createClient(
      () =>
        Response.json({
          id: "resp-test",
          created_at: 0,
          model: "reasoner",
          status: "completed",
          output: [{ type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' }],
        }),
      "responses",
    );

    await expect(client.completion(request)).resolves.toMatchObject({
      object: "chat.completion",
      choices: [
        {
          message: {
            tool_calls: [{ id: "call-1", function: { name: "get_weather", arguments: '{"city":"Madrid"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(paths).toEqual(["/v1/responses"]);
    expect(sent[0]).toMatchObject({
      model: "reasoner",
      input: [{ type: "message", role: "user", content: "What is the weather in Madrid?" }],
      tools: [{ type: "function", name: "get_weather" }],
    });
    expect(sent[0]).not.toHaveProperty("messages");
  });

  it("translates the conversation, the tools and the parameters of a request", () => {
    const completionRequest: OpenAICompletionRequest = {
      model: "reasoner",
      stream: true,
      max_completion_tokens: 1024,
      temperature: 0.2,
      tool_choice: { type: "function", function: { name: "get_weather" } },
      messages: [
        { role: "system", content: "" },
        { role: "user", content: "What is the weather in Madrid?" },
        {
          role: "assistant",
          content: "Let me check.",
          tool_calls: [
            { id: "call-1", type: "function", function: { name: "get_weather", arguments: '{"city":"Madrid"}' } },
          ],
        },
        { role: "tool", content: "Sunny", tool_call_id: "call-1" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get the weather of a city",
            parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          },
        },
      ],
    };

    expect(toResponsesRequest(completionRequest)).toEqual({
      model: "reasoner",
      stream: true,
      store: false,
      max_output_tokens: 1024,
      temperature: 0.2,
      tool_choice: { type: "function", name: "get_weather" },
      input: [
        { type: "message", role: "user", content: "What is the weather in Madrid?" },
        { type: "message", role: "assistant", content: "Let me check." },
        { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
        { type: "function_call_output", call_id: "call-1", output: "Sunny" },
      ],
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get the weather of a city",
          parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          strict: false,
        },
      ],
    });
  });

  it("translates the answer and the tool calls of a response, without its reasoning", () => {
    const translated = fromResponsesResponse({
      id: "resp-1",
      created_at: 1700000000,
      model: "reasoner",
      status: "completed",
      output: [
        { type: "reasoning", content: [{ type: "reasoning_text", text: "The user asks for the weather" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Let me check." }] },
        { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });

    expect(translated).toEqual({
      id: "resp-1",
      object: "chat.completion",
      created: 1700000000,
      model: "reasoner",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Let me check.",
            refusal: null,
            tool_calls: [
              { id: "call-1", type: "function", function: { name: "get_weather", arguments: '{"city":"Madrid"}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  });

  it("marks a response cut by the token limit", () => {
    const translated = fromResponsesResponse({
      id: "resp-1",
      model: "reasoner",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
    });

    expect(translated.choices[0]?.finish_reason).toBe("length");
  });

  it("rejects a failed or malformed response", () => {
    const failed = {
      id: "resp-1",
      model: "reasoner",
      status: "failed",
      error: { code: "server_error", message: "The model failed" },
      output: [],
    };

    expect(() => fromResponsesResponse(failed)).toThrow("AI service completion request failed: The model failed");
    expect(() => fromResponsesResponse({ id: "resp-1" })).toThrow("Invalid AI service completion response format");
  });

  it("translates the events of a streamed response", async () => {
    const response = { id: "resp-1", created_at: 1700000000, model: "reasoner", output: [] };
    const stream = fromResponsesStream(
      streamOf([
        { type: "response.created", response: { ...response, status: "in_progress" } },
        { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", content: [] } },
        { type: "response.reasoning_text.delta", output_index: 0, delta: "The user asks for the weather" },
        { type: "response.output_item.added", output_index: 1, item: { type: "message", content: [] } },
        { type: "response.output_text.delta", output_index: 1, delta: "Let me " },
        { type: "response.output_text.delta", output_index: 1, delta: "check." },
        {
          type: "response.output_item.added",
          output_index: 2,
          item: { type: "function_call", call_id: "call-1", name: "get_weather", arguments: "" },
        },
        { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"city":' },
        { type: "response.function_call_arguments.delta", output_index: 2, delta: '"Madrid"}' },
        { type: "response.function_call_arguments.done", output_index: 2, arguments: '{"city":"Madrid"}' },
        {
          type: "response.completed",
          response: {
            ...response,
            status: "completed",
            usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
          },
        },
      ]),
    );

    const { content, toolCalls, finishReasons } = await readStream(stream);
    expect(content).toBe("Let me check.");
    expect(toolCalls).toEqual([
      { id: "call-1", type: "function", function: { name: "get_weather", arguments: '{"city":"Madrid"}' } },
    ]);
    expect(finishReasons).toEqual(["tool_calls"]);
  });

  it("fails the stream of a response that fails", async () => {
    const stream = fromResponsesStream(
      streamOf([
        { type: "response.output_text.delta", output_index: 0, delta: "Let me " },
        { type: "response.failed", response: { status: "failed", error: { message: "The model failed" } } },
      ]),
    );

    await expect(readStream(stream)).rejects.toThrow("AI service completion request failed: The model failed");
  });
});
