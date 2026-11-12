import { afterEach, describe, expect, it, vi } from "vitest";

import type { LlmRequest } from "#layers/ai/shared/llm";
import { fromMessagesResponse, fromMessagesStream, toMessagesRequest } from "#layers/ai/server/lib/anthropic/messages";
import { createClient, readStream, streamOf } from "#layers/ai/tests/unit/helpers/llm";

const request: LlmRequest = {
  input: [{ type: "message", role: "user", content: "What is the weather in Madrid?" }],
  stream: false,
  tools: [{ type: "function", name: "get_weather", parameters: { type: "object", properties: {} } }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("anthropic messages", () => {
  it("uses the Messages API of the providers set up with it", async () => {
    const { client, sent, paths, headers } = createClient(() => {
      return Response.json({
        id: "msg-test",
        model: "reasoner",
        content: [{ type: "tool_use", id: "call-1", name: "get_weather", input: { city: "Madrid" } }],
        stop_reason: "tool_use",
      });
    }, "messages");

    await expect(client.completion(request)).resolves.toEqual({
      output: [{ type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' }],
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
    const completionRequest: LlmRequest = {
      model: "reasoner",
      stream: true,
      max_output_tokens: 1024,
      reasoning: { effort: "low" },
      temperature: 0.2,
      input: [
        { type: "message", role: "system", content: "Be brief." },
        { type: "function_call", call_id: "call-0", name: "get_weather", arguments: '{"city":"Lyon"}' },
        { type: "function_call_output", call_id: "call-0", output: "Cloudy" },
        { type: "message", role: "assistant", content: "It is cloudy in Lyon." },
        { type: "message", role: "user", content: "What is the weather in Madrid and in Paris?" },
        { type: "reasoning", content: "The user asks for the weather", encrypted_content: "signature" },
        { type: "reasoning", encrypted_content: "redacted" },
        { type: "message", role: "assistant", content: "Let me check." },
        { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
        { type: "function_call", call_id: "call-2", name: "get_weather", arguments: "" },
        { type: "function_call_output", call_id: "call-1", output: "Sunny" },
        { type: "function_call_output", call_id: "call-2", output: "Error: city is required" },
      ],
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get the weather of a city",
          parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      ],
    };

    expect(toMessagesRequest(completionRequest)).toEqual({
      model: "reasoner",
      system: "Be brief.",
      stream: true,
      max_tokens: 1024,
      output_config: { effort: "low" },
      messages: [
        { role: "user", content: [{ type: "text", text: "What is the weather in Madrid and in Paris?" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "The user asks for the weather", signature: "signature" },
            { type: "redacted_thinking", data: "redacted" },
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

  it("translates the thinking, the answer and the tool calls of a response", () => {
    const translated = fromMessagesResponse({
      id: "msg-1",
      model: "reasoner",
      content: [
        { type: "thinking", thinking: "The user asks for the weather", signature: "signature" },
        { type: "redacted_thinking", data: "redacted" },
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "call-1", name: "get_weather", input: { city: "Madrid" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    expect(translated).toEqual({
      output: [
        { type: "reasoning", content: "The user asks for the weather", encrypted_content: "signature" },
        { type: "reasoning", encrypted_content: "redacted" },
        { type: "message", role: "assistant", content: "Let me check." },
        { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
      ],
    });
  });

  it("tells when the model declines to answer or runs out of tokens", async () => {
    const response = { id: "msg-1", model: "reasoner", content: [] };

    expect(
      fromMessagesResponse({
        ...response,
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "Flagged by the safeguards" },
      }),
    ).toEqual({ output: [], incomplete_details: { reason: "content_filter", message: "Flagged by the safeguards" } });

    expect(
      fromMessagesResponse({ ...response, content: [{ type: "text", text: "Once upon" }], stop_reason: "max_tokens" }),
    ).toEqual({
      output: [{ type: "message", role: "assistant", content: "Once upon" }],
      incomplete_details: { reason: "max_output_tokens" },
    });

    const reader = fromMessagesStream(
      streamOf([
        { type: "message_start", message: { id: "msg-1", model: "reasoner", content: [] } },
        { type: "message_delta", delta: { stop_reason: "refusal", stop_details: { explanation: "Flagged" } } },
        { type: "message_stop" },
      ]),
    ).getReader();
    expect((await reader.read()).value).toEqual({
      type: "response.completed",
      response: { output: [], incomplete_details: { reason: "content_filter", message: "Flagged" } },
    });
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
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "The user asks" } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signature" } },
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

    const { text, output } = await readStream(stream);
    expect(text).toBe("Let me check.");
    expect(output).toEqual([
      { type: "reasoning", content: "The user asks", encrypted_content: "signature" },
      { type: "message", role: "assistant", content: "Let me check." },
      { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
      { type: "function_call", call_id: "call-2", name: "get_time", arguments: "{}" },
    ]);
  });

  it("fails the stream of a response that fails", async () => {
    const stream = fromMessagesStream(
      streamOf([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } },
        { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      ]),
    );

    await expect(readStream(stream)).rejects.toThrow("AI service completion request failed: Overloaded");
  });
});
