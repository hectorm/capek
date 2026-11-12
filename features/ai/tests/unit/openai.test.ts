import { afterEach, describe, expect, it, vi } from "vitest";

import type { LlmRequest } from "#layers/ai/shared/llm";
import {
  fromChatCompletionsResponse,
  fromChatCompletionsStream,
  toChatCompletionsRequest,
} from "#layers/ai/server/lib/openai/chatCompletions";
import { fromResponsesResponse, fromResponsesStream, toResponsesRequest } from "#layers/ai/server/lib/openai/responses";
import { createClient, readStream, streamOf } from "#layers/ai/tests/unit/helpers/llm";

const request: LlmRequest = {
  input: [{ type: "message", role: "user", content: "What is the weather in Madrid?" }],
  stream: false,
  tools: [{ type: "function", name: "get_weather", parameters: { type: "object", properties: {} } }],
};

const chunk = { object: "chat.completion.chunk", created: 0, model: "reasoner" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai chat completions", () => {
  it("uses the Chat Completions API of the providers set up with it", async () => {
    const { client, sent, paths, headers } = createClient(() =>
      Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "reasoner",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                { id: "call-1", type: "function", function: { name: "get_weather", arguments: '{"city":"Madrid"}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );

    await expect(client.completion(request)).resolves.toEqual({
      output: [{ type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' }],
    });
    expect(paths).toEqual(["/v1/chat/completions"]);
    expect(headers[0]?.get("authorization")).toBe("Bearer hunter2");
    expect(sent[0]).toMatchObject({
      model: "reasoner",
      messages: [{ role: "user", content: "What is the weather in Madrid?" }],
      tools: [{ type: "function", function: { name: "get_weather" } }],
    });
  });

  it("translates the conversation, the tools and the parameters of a request", () => {
    const signature = { google: { thought_signature: "signature" } };
    const completionRequest: LlmRequest = {
      model: "reasoner",
      stream: true,
      max_output_tokens: 1024,
      reasoning: { effort: "low" },
      temperature: 0.2,
      input: [
        { type: "message", role: "system", content: "Be brief." },
        { type: "message", role: "assistant", content: "" },
        { type: "message", role: "user", content: "What is the weather in Madrid and in Paris?" },
        { type: "message", role: "assistant", content: "Let me check." },
        { type: "reasoning", encrypted_content: JSON.stringify(signature) },
        { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
        { type: "function_call", call_id: "call-2", name: "get_weather", arguments: '{"city":"Paris"}' },
        { type: "function_call_output", call_id: "call-1", output: "Sunny" },
        { type: "function_call_output", call_id: "call-2", output: "Rainy" },
        { type: "function_call", call_id: "call-3", name: "get_weather", arguments: '{"city":"Lyon"}' },
        { type: "function_call_output", call_id: "call-3", output: "Cloudy" },
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

    expect(toChatCompletionsRequest(completionRequest)).toEqual({
      model: "reasoner",
      stream: true,
      max_completion_tokens: 1024,
      reasoning_effort: "low",
      temperature: 0.2,
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "What is the weather in Madrid and in Paris?" },
        {
          role: "assistant",
          content: "Let me check.",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Madrid"}' },
              extra_content: signature,
            },
            { id: "call-2", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
          ],
        },
        { role: "tool", content: "Sunny", tool_call_id: "call-1" },
        { role: "tool", content: "Rainy", tool_call_id: "call-2" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call-3", type: "function", function: { name: "get_weather", arguments: '{"city":"Lyon"}' } },
          ],
        },
        { role: "tool", content: "Cloudy", tool_call_id: "call-3" },
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
    });
  });

  it("keeps the text of an answer split in parts", () => {
    const translated = fromChatCompletionsResponse({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 0,
      model: "reasoner",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: [{ type: "text", text: "It is about Madrid" }], closed: true },
              { type: "text", text: "Sunny" },
            ],
          },
          finish_reason: "stop",
        },
      ],
    });

    expect(translated).toEqual({ output: [{ type: "message", role: "assistant", content: "Sunny" }] });
  });

  it("tells when the model declines to answer or runs out of tokens", async () => {
    const completion = (message: Record<string, unknown>, finishReason: string) => ({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "reasoner",
      choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finishReason }],
    });

    expect(fromChatCompletionsResponse(completion({ content: "Once upon" }, "length"))).toEqual({
      output: [{ type: "message", role: "assistant", content: "Once upon" }],
      incomplete_details: { reason: "max_output_tokens" },
    });
    expect(fromChatCompletionsResponse(completion({ content: null }, "content_filter")).incomplete_details).toEqual({
      reason: "content_filter",
    });
    expect(
      fromChatCompletionsResponse(completion({ content: null, refusal: "I cannot help with that" }, "stop"))
        .incomplete_details,
    ).toEqual({ reason: "content_filter", message: "I cannot help with that" });
    expect(fromChatCompletionsResponse(completion({ content: "Done" }, "stop")).incomplete_details).toBeUndefined();

    const reader = fromChatCompletionsStream(
      streamOf([
        { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "Once upon" } }] },
        { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "length" }] },
      ]),
    ).getReader();
    await reader.read();
    expect((await reader.read()).value).toMatchObject({
      type: "response.completed",
      response: { incomplete_details: { reason: "max_output_tokens" } },
    });

    const filtered = fromChatCompletionsStream(
      streamOf([{ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }] }]),
    ).getReader();
    expect((await filtered.read()).value).toEqual({
      type: "response.completed",
      response: { output: [], incomplete_details: { reason: "content_filter", message: undefined } },
    });
  });

  it("rejects a malformed response", () => {
    expect(() => fromChatCompletionsResponse({ id: "chatcmpl-1" })).toThrow(
      "Invalid AI service completion response format",
    );
  });

  it("keeps the text of a streamed answer split in parts", async () => {
    const deltas = [
      [{ type: "thinking", thinking: [{ type: "text", text: "It is about Madrid" }] }],
      [{ type: "text", text: "Sun" }],
      "ny",
    ];
    const stream = fromChatCompletionsStream(
      streamOf([
        ...deltas.map((content) => ({ ...chunk, choices: [{ index: 0, delta: { content } }] })),
        { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ]),
    );

    const { text, output } = await readStream(stream);
    expect(text).toBe("Sunny");
    expect(output).toEqual([{ type: "message", role: "assistant", content: "Sunny" }]);
  });

  it("fails a streamed answer that is cut or that fails before it ends", async () => {
    const delta = { ...chunk, choices: [{ index: 0, delta: { content: "Sun" } }] };
    await expect(readStream(fromChatCompletionsStream(streamOf([delta])))).rejects.toThrow(
      "the answer ended before it was complete",
    );
    await expect(
      readStream(fromChatCompletionsStream(streamOf([delta, { error: { message: "Overloaded" } }]))),
    ).rejects.toThrow("Overloaded");
  });

  it("reads the streamed tool calls of a provider that sends null for the fields it leaves out", async () => {
    const toolCall = { index: 0, type: "function" };
    const deltas = [
      { role: "assistant", content: "" },
      {
        role: null,
        content: null,
        tool_calls: [{ ...toolCall, id: "call-1", function: { name: "get_weather", arguments: "" } }],
      },
      {
        role: null,
        content: null,
        tool_calls: [{ ...toolCall, id: null, function: { name: null, arguments: '{"city":' } }],
      },
      {
        role: null,
        content: null,
        tool_calls: [{ ...toolCall, id: null, function: { name: null, arguments: '"Madrid"}' } }],
      },
    ];
    const stream = fromChatCompletionsStream(
      streamOf([
        ...deltas.map((delta) => ({ ...chunk, choices: [{ index: 0, delta }] })),
        { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]),
    );

    const { output } = await readStream(stream);
    expect(output).toEqual([
      { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
    ]);
  });

  it("joins the streamed arguments of a provider that sends the ID and the name of a call with each delta", async () => {
    const toolCall = (index: number, id: string, args: string) => ({
      index,
      id,
      type: "function",
      function: { name: "get_weather", arguments: args },
    });
    const deltas = [
      { tool_calls: [toolCall(0, "call-1", '{"city":')] },
      { tool_calls: [toolCall(0, "call-1", '"Madrid"}')] },
      { tool_calls: [toolCall(1, "call-2", '{"city":"Paris"}')] },
    ];
    const stream = fromChatCompletionsStream(
      streamOf([
        ...deltas.map((delta) => ({ ...chunk, choices: [{ index: 0, delta }] })),
        { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]),
    );

    const { output } = await readStream(stream);
    expect(output).toEqual([
      { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
      { type: "function_call", call_id: "call-2", name: "get_weather", arguments: '{"city":"Paris"}' },
    ]);
  });

  it("keeps the streamed tool calls without an index and the data that the provider needs back with them", async () => {
    const signature = { google: { thought_signature: "signature" } };
    const deltas = [
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Madrid"}' },
            extra_content: signature,
          },
        ],
      },
      {
        role: "assistant",
        tool_calls: [
          { id: "call-2", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
        ],
      },
    ];
    const stream = fromChatCompletionsStream(
      streamOf([
        ...deltas.map((delta) => ({ ...chunk, choices: [{ index: 0, delta }] })),
        { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]),
    );

    const { output } = await readStream(stream);
    expect(output).toEqual([
      { type: "reasoning", encrypted_content: JSON.stringify(signature) },
      { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
      { type: "function_call", call_id: "call-2", name: "get_weather", arguments: '{"city":"Paris"}' },
    ]);
  });
});

describe("openai responses", () => {
  it("uses the Responses API of the providers set up with it", async () => {
    const { client, sent, paths, headers } = createClient(
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

    await expect(client.completion(request)).resolves.toEqual({
      output: [{ type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' }],
    });
    expect(paths).toEqual(["/v1/responses"]);
    expect(headers[0]?.get("authorization")).toBe("Bearer hunter2");
    expect(sent[0]).toMatchObject({
      model: "reasoner",
      input: [{ type: "message", role: "user", content: "What is the weather in Madrid?" }],
      tools: [{ type: "function", name: "get_weather" }],
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
        { type: "message", role: "system", content: "" },
        { type: "message", role: "user", content: "What is the weather in Madrid?" },
        { type: "reasoning", content: "The user asks for the weather", encrypted_content: "encrypted" },
        { type: "message", role: "assistant", content: "Let me check." },
        {
          type: "function_call",
          call_id: "call-1",
          name: "get_weather",
          arguments: '{"city":"Madrid"}',
          description: "Weather of Madrid",
        },
        { type: "function_call_output", call_id: "call-1", output: "Sunny" },
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

    expect(toResponsesRequest(completionRequest)).toEqual({
      model: "reasoner",
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: 1024,
      reasoning: { effort: "low" },
      temperature: 0.2,
      input: [
        { type: "message", role: "user", content: "What is the weather in Madrid?" },
        {
          type: "reasoning",
          summary: [],
          content: [{ type: "reasoning_text", text: "The user asks for the weather" }],
          encrypted_content: "encrypted",
        },
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

  it("translates the reasoning, the answer and the tool calls of a response", () => {
    const translated = fromResponsesResponse({
      id: "resp-1",
      created_at: 1700000000,
      model: "reasoner",
      status: "completed",
      output: [
        {
          type: "reasoning",
          summary: [],
          content: [{ type: "reasoning_text", text: "The user asks for the weather" }],
          encrypted_content: "encrypted",
        },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Let me check." }] },
        { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });

    expect(translated).toEqual({
      output: [
        { type: "reasoning", content: "The user asks for the weather", encrypted_content: "encrypted" },
        { type: "message", role: "assistant", content: "Let me check." },
        { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
      ],
    });
  });

  it("tells when the model declines to answer or runs out of tokens", () => {
    const response = { id: "resp-1", model: "reasoner", output: [] };

    expect(
      fromResponsesResponse({ ...response, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })
        .incomplete_details,
    ).toEqual({ reason: "max_output_tokens" });
    expect(
      fromResponsesResponse({
        ...response,
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal", refusal: "I cannot help with that" }] }],
      }).incomplete_details,
    ).toEqual({ reason: "content_filter", message: "I cannot help with that" });
    expect(fromResponsesResponse({ ...response, status: "completed" }).incomplete_details).toBeUndefined();
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
    const response = { id: "resp-1", created_at: 1700000000, model: "reasoner" };
    const output = [
      { type: "reasoning", summary: [], encrypted_content: "encrypted" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Let me check." }] },
      { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
    ];
    const stream = fromResponsesStream(
      streamOf([
        { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", summary: [] } },
        { type: "response.output_item.done", output_index: 0, item: output[0] },
        { type: "response.output_item.added", output_index: 1, item: { type: "message", content: [] } },
        { type: "response.output_text.delta", output_index: 1, delta: "Let me " },
        { type: "response.output_text.delta", output_index: 1, delta: "check." },
        { type: "response.output_item.done", output_index: 1, item: output[1] },
        {
          type: "response.output_item.added",
          output_index: 2,
          item: { type: "function_call", call_id: "call-1", name: "get_weather", arguments: "" },
        },
        { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"city":"Madrid"}' },
        { type: "response.output_item.done", output_index: 2, item: output[2] },
        { type: "response.completed", response: { ...response, status: "completed", output } },
      ]),
    );

    const translated = await readStream(stream);
    expect(translated.text).toBe("Let me check.");
    expect(translated.output).toEqual([
      { type: "reasoning", encrypted_content: "encrypted" },
      { type: "message", role: "assistant", content: "Let me check." },
      { type: "function_call", call_id: "call-1", name: "get_weather", arguments: '{"city":"Madrid"}' },
    ]);
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
