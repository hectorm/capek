import type { LlmItem, LlmRequest, LlmResponse, LlmStreamEvent } from "#layers/ai/shared/llm";
import type { OpenAICompletionRequest, OpenAIMessage, OpenAIToolCall } from "#layers/ai/shared/openai";
import { SSEProcessor } from "#layers/ai/server/lib/sse";
import { OpenAICompletionResponseSchema, OpenAIStreamChunkSchema } from "#layers/ai/shared/openai";

// The data that a provider needs back with a tool call is the reasoning that precedes it
const toExtraContent = (encryptedContent?: string): OpenAIToolCall["extra_content"] => {
  try {
    return JSON.parse(encryptedContent ?? "") as OpenAIToolCall["extra_content"];
  } catch {
    return undefined;
  }
};

const fromMessage = (content: string, toolCalls: OpenAIToolCall[]): LlmItem[] => {
  const output: LlmItem[] = [];

  if (content) {
    output.push({ type: "message", role: "assistant", content });
  }
  for (const toolCall of toolCalls) {
    if (toolCall.extra_content) {
      output.push({ type: "reasoning", encrypted_content: JSON.stringify(toolCall.extra_content) });
    }
    output.push({
      type: "function_call",
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    });
  }

  return output;
};

// Translates a request to the Chat Completions API
export const toChatCompletionsRequest = (request: LlmRequest): OpenAICompletionRequest => {
  const messages: OpenAIMessage[] = [];
  let extraContent: OpenAIToolCall["extra_content"];

  for (const item of request.input) {
    switch (item.type) {
      case "message":
        if (item.content) {
          messages.push({ role: item.role, content: item.content });
        }
        break;
      case "reasoning":
        extraContent = toExtraContent(item.encrypted_content);
        break;
      case "function_call": {
        const toolCall: OpenAIToolCall = {
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
          extra_content: extraContent,
        };
        extraContent = undefined;

        const last = messages.at(-1);
        if (last?.role === "assistant") {
          last.tool_calls = [...(last.tool_calls ?? []), toolCall];
        } else {
          messages.push({ role: "assistant", content: "", tool_calls: [toolCall] });
        }
        break;
      }
      case "function_call_output":
        messages.push({ role: "tool", content: item.output, tool_call_id: item.call_id });
        break;
    }
  }

  return {
    model: request.model,
    messages,
    stream: request.stream,
    max_completion_tokens: request.max_output_tokens,
    reasoning_effort: request.reasoning?.effort,
    temperature: request.temperature,
    top_p: request.top_p,
    frequency_penalty: request.frequency_penalty,
    presence_penalty: request.presence_penalty,
    tools: request.tools?.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    })),
  };
};

// Translates a response of the Chat Completions API
export const fromChatCompletionsResponse = (rawResponse: unknown): LlmResponse => {
  const parsed = OpenAICompletionResponseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(`Invalid AI service completion response format: ${parsed.error.message}`);
  }

  const message = parsed.data.choices[0]?.message;

  return { output: fromMessage(message?.content ?? "", message?.tool_calls ?? []) };
};

// Translates the chunks of a streamed response of the Chat Completions API
export const fromChatCompletionsStream = (stream: ReadableStream<Uint8Array>): ReadableStream<LlmStreamEvent> => {
  const pendingEvents: string[] = [];
  const sseProcessor = new SSEProcessor({ onEvent: (event) => pendingEvents.push(event.data) });

  let content = "";
  const toolCalls = new Map<number, OpenAIToolCall>();

  const translateEvents = (controller: TransformStreamDefaultController<LlmStreamEvent>): void => {
    for (const data of pendingEvents.splice(0)) {
      let rawChunk: unknown;
      try {
        rawChunk = JSON.parse(data);
      } catch {
        continue;
      }
      const parsed = OpenAIStreamChunkSchema.safeParse(rawChunk);
      if (!parsed.success) {
        continue;
      }

      const delta = parsed.data.choices.at(0)?.delta;
      if (delta?.content) {
        content += delta.content;
        controller.enqueue({ type: "response.output_text.delta", delta: delta.content });
      }

      for (const toolCall of delta?.tool_calls ?? []) {
        const index = toolCall.index ?? (toolCall.id ? toolCalls.size : Math.max(toolCalls.size - 1, 0));
        const existing = toolCalls.get(index);

        if (toolCall.id && toolCall.function?.name) {
          toolCalls.set(index, {
            id: toolCall.id,
            type: "function",
            function: { name: toolCall.function.name, arguments: toolCall.function.arguments ?? "" },
            extra_content: toolCall.extra_content,
          });
        } else if (existing && toolCall.function?.arguments) {
          existing.function.arguments += toolCall.function.arguments;
        }
      }
    }
  };

  return stream.pipeThrough(
    new TransformStream<Uint8Array, LlmStreamEvent>({
      transform(bytes, controller) {
        sseProcessor.process(bytes);
        translateEvents(controller);
      },
      flush(controller) {
        sseProcessor.flush();
        translateEvents(controller);
        controller.enqueue({
          type: "response.completed",
          response: { output: fromMessage(content, Array.from(toolCalls.values())) },
        });
      },
    }),
  );
};
