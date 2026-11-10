import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenAICompletionRequest } from "#layers/ai/shared/openai";
import { fromMessagesResponse, fromMessagesStream, toMessagesRequest } from "#layers/ai/server/lib/anthropic/messages";
import { createClient, readStream, streamOf } from "#layers/ai/tests/unit/helpers/openai";

const request: OpenAICompletionRequest = {
  messages: [{ role: "user", content: "What is the weather in Madrid?" }],
  stream: false,
  tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: {} } } }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("anthropic messages", () => {
  it("uses the Messages API of the providers set up with it", async () => {
    const { client, sent, paths, headers } = createClient(
      () =>
        Response.json({
          id: "msg-test",
          model: "reasoner",
          content: [{ type: "tool_use", id: "call-1", name: "get_weather", input: { city: "Madrid" } }],
          stop_reason: "tool_use",
        }),
      "messages",
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
    expect(paths).toEqual(["/v1/messages"]);
    expect(headers[0]?.get("x-api-key")).toBe("hunter2");
    expect(headers[0]?.get("anthropic-version")).toBe("2026-10-21");
    expect(headers[0]?.has("authorization")).toBe(false);
    expect(sent[0]).toMatchObject({
      model: "reasoner",
      messages: [{ role: "user", content: [{ type: "text", text: "What is the weather in Madrid?" }] }],
      tools: [{ name: "get_weather" }],
    });
  });

  it("translates the conversation, the tools and the parameters of a request", () => {
    const completionRequest: OpenAICompletionRequest = {
      model: "reasoner",
      stream: true,
      max_completion_tokens: 1024,
      reasoning_effort: "low",
      temperature: 0.2,
      tool_choice: "required",
      parallel_tool_calls: false,
      messages: [
        { role: "system", content: "Be brief." },
        { role: "assistant", content: "Hello! How can I help?" },
        { role: "user", content: "What is the weather in Madrid and in Paris?" },
        {
          role: "assistant",
          content: "Let me check.",
          tool_calls: [
            { id: "call-1", type: "function", function: { name: "get_weather", arguments: '{"city":"Madrid"}' } },
            { id: "call-2", type: "function", function: { name: "get_weather", arguments: "" } },
          ],
        },
        { role: "tool", content: "Sunny", tool_call_id: "call-1" },
        { role: "tool", content: "Error: city is required", tool_call_id: "call-2" },
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

    expect(toMessagesRequest(completionRequest)).toEqual({
      model: "reasoner",
      system: "Be brief.",
      stream: true,
      max_tokens: 1024,
      output_config: { effort: "low" },
      tool_choice: { type: "any", disable_parallel_tool_use: true },
      messages: [
        { role: "user", content: [{ type: "text", text: "What is the weather in Madrid and in Paris?" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            { type: "tool_use", id: "call-1", name: "get_weather", input: { city: "Madrid" } },
            { type: "tool_use", id: "call-2", name: "get_weather", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call-1", content: "Sunny" },
            { type: "tool_result", tool_use_id: "call-2", content: "Error: city is required" },
          ],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get the weather of a city",
          input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      ],
    });
  });

  it("limits the tokens of a request that does not", () => {
    expect(toMessagesRequest(request).max_tokens).toBe(8192);
  });

  it("translates the answer and the tool calls of a response, without its thinking", () => {
    const translated = fromMessagesResponse({
      id: "msg-1",
      model: "reasoner",
      content: [
        { type: "thinking", thinking: "The user asks for the weather", signature: "signature" },
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "call-1", name: "get_weather", input: { city: "Madrid" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    expect(translated).toEqual({
      id: "msg-1",
      object: "chat.completion",
      created: 0,
      model: "reasoner",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Let me check.",
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
    const translated = fromMessagesResponse({
      id: "msg-1",
      model: "reasoner",
      content: [{ type: "text", text: "It is" }],
      stop_reason: "max_tokens",
    });

    expect(translated.choices[0]?.finish_reason).toBe("length");
  });

  it("rejects a malformed response", () => {
    expect(() => fromMessagesResponse({ id: "msg-1" })).toThrow("Invalid AI service completion response format");
  });

  it("translates the events of a streamed response", async () => {
    const stream = fromMessagesStream(
      streamOf([
        {
          type: "message_start",
          message: { id: "msg-1", model: "reasoner", content: [], usage: { input_tokens: 10 } },
        },
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "The user asks" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Let me " } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "check." } },
        { type: "content_block_stop", index: 1 },
        {
          type: "content_block_start",
          index: 2,
          content_block: { type: "tool_use", id: "call-1", name: "get_weather", input: {} },
        },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "" } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"city":' } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"Madrid"}' } },
        { type: "content_block_stop", index: 2 },
        {
          type: "content_block_start",
          index: 3,
          content_block: { type: "tool_use", id: "call-2", name: "get_time", input: {} },
        },
        { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: "" } },
        { type: "content_block_stop", index: 3 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
        { type: "message_stop" },
      ]),
    );

    const { content, toolCalls, finishReasons } = await readStream(stream);
    expect(content).toBe("Let me check.");
    expect(toolCalls).toEqual([
      { id: "call-1", type: "function", function: { name: "get_weather", arguments: '{"city":"Madrid"}' } },
      { id: "call-2", type: "function", function: { name: "get_time", arguments: "{}" } },
    ]);
    expect(finishReasons).toEqual(["tool_calls"]);
  });

  it("fails the stream of a response that fails", async () => {
    const stream = fromMessagesStream(
      streamOf([
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } },
        { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      ]),
    );

    await expect(readStream(stream)).rejects.toThrow("AI service completion request failed: Overloaded");
  });
});
