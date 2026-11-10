import type {
  AnthropicMessagesInputBlock,
  AnthropicMessagesMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesToolChoice,
  AnthropicMessagesUsage,
} from "#layers/ai/shared/anthropic";
import type {
  OpenAICompletionRequest,
  OpenAICompletionResponse,
  OpenAIStreamChunk,
  OpenAIToolCall,
} from "#layers/ai/shared/openai";
import { SSEProcessor } from "#layers/ai/server/lib/sse";
import { AgentExecutorParameters } from "#layers/ai/shared/agent";
import { AnthropicMessagesResponseSchema, AnthropicMessagesStreamEventSchema } from "#layers/ai/shared/anthropic";

const failure = (message?: string | null): Error =>
  new Error(`AI service completion request failed: ${message ?? "unknown error"}`);

const toUsage = (usage?: AnthropicMessagesUsage | null): OpenAICompletionResponse["usage"] =>
  usage && {
    prompt_tokens: usage.input_tokens ?? 0,
    completion_tokens: usage.output_tokens ?? 0,
    total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
  };

const toFinishReason = (stopReason?: string | null): string => {
  switch (stopReason) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "refusal":
      return "content_filter";
    default:
      return "stop";
  }
};

const toToolInput = (toolArguments: string): Record<string, unknown> => {
  try {
    const input: unknown = JSON.parse(toolArguments);
    return typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const toToolChoice = (request: OpenAICompletionRequest): AnthropicMessagesToolChoice | undefined => {
  if (request.tool_choice === undefined && request.parallel_tool_calls !== false) {
    return undefined;
  }
  if (request.tool_choice === "none") {
    return { type: "none" };
  }

  const toolChoice: AnthropicMessagesToolChoice =
    typeof request.tool_choice === "object"
      ? { type: "tool", name: request.tool_choice.function.name }
      : { type: request.tool_choice === "required" ? "any" : "auto" };
  if (request.parallel_tool_calls === false) {
    toolChoice.disable_parallel_tool_use = true;
  }

  return toolChoice;
};

// Translates a request of Chat Completions to the Messages API of Anthropic
export const toMessagesRequest = (request: OpenAICompletionRequest): AnthropicMessagesRequest => {
  const system: string[] = [];
  const messages: AnthropicMessagesMessage[] = [];

  for (const message of request.messages) {
    if (message.role === "system" || message.role === "developer") {
      if (message.content) {
        system.push(message.content);
      }
      continue;
    }

    const blocks: AnthropicMessagesInputBlock[] = [];
    if (message.role === "tool") {
      blocks.push({ type: "tool_result", tool_use_id: message.tool_call_id ?? "", content: message.content ?? "" });
    } else {
      if (message.content) {
        blocks.push({ type: "text", text: message.content });
      }
      for (const toolCall of message.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: toToolInput(toolCall.function.arguments),
        });
      }
    }

    // Messages take turns starting with the user, so the results of the tools called in a turn go together
    const role = message.role === "assistant" ? "assistant" : "user";
    const last = messages.at(-1);
    if (last?.role === role) {
      last.content.push(...blocks);
    } else if (blocks.length > 0 && (last || role === "user")) {
      messages.push({ role, content: blocks });
    }
  }

  // The sampling parameters, the penalties and the seed of the request have no equivalent
  return {
    model: request.model,
    system: system.length > 0 ? system.join("\n\n") : undefined,
    messages,
    stream: request.stream,
    // The limit of tokens is mandatory
    max_tokens: request.max_completion_tokens ?? AgentExecutorParameters.maxTokens.default,
    output_config: request.reasoning_effort ? { effort: request.reasoning_effort } : undefined,
    stop_sequences: typeof request.stop === "string" ? [request.stop] : request.stop,
    metadata: request.user ? { user_id: request.user } : undefined,
    tools: request.tools?.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters ?? { type: "object", properties: {} },
      strict: tool.function.strict,
    })),
    tool_choice: toToolChoice(request),
  };
};

// Translates a response of the Messages API to Chat Completions
export const fromMessagesResponse = (rawResponse: unknown): OpenAICompletionResponse => {
  const parsed = AnthropicMessagesResponseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(`Invalid AI service completion response format: ${parsed.error.message}`);
  }

  const response = parsed.data;

  let content = "";
  const toolCalls: OpenAIToolCall[] = [];

  // The thinking of the model is not part of its answer
  for (const block of response.content) {
    if (block.type === "text") {
      content += block.text ?? "";
    } else if (block.type === "tool_use" && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }

  return {
    id: response.id,
    object: "chat.completion",
    created: 0,
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : null,
        },
        finish_reason: toFinishReason(response.stop_reason),
      },
    ],
    usage: toUsage(response.usage),
  };
};

// Translates the events of a streamed response of the Messages API to the chunks of Chat Completions
export const fromMessagesStream = (stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const pendingEvents: string[] = [];
  const sseProcessor = new SSEProcessor({ onEvent: (event) => pendingEvents.push(event.data) });

  let id = "";
  let model = "";
  let stopReason: string | null = null;
  let usage: AnthropicMessagesUsage = {};
  const toolCallsWithoutArguments = new Set<number>();

  const encodeChunk = (
    choice: Omit<OpenAIStreamChunk["choices"][number], "index">,
    chunkUsage?: OpenAIStreamChunk["usage"],
  ): Uint8Array => {
    const chunk: OpenAIStreamChunk = {
      id,
      object: "chat.completion.chunk",
      created: 0,
      model,
      choices: [{ index: 0, ...choice }],
      usage: chunkUsage,
    };
    return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  const translateEvents = (controller: TransformStreamDefaultController<Uint8Array>): void => {
    for (const data of pendingEvents.splice(0)) {
      let rawEvent: unknown;
      try {
        rawEvent = JSON.parse(data);
      } catch {
        continue;
      }
      const parsed = AnthropicMessagesStreamEventSchema.safeParse(rawEvent);
      if (!parsed.success) {
        continue;
      }

      const event = parsed.data;
      const index = event.index ?? 0;

      switch (event.type) {
        case "message_start":
          id = event.message?.id ?? id;
          model = event.message?.model ?? model;
          usage = { ...usage, ...event.message?.usage };
          break;
        case "content_block_start":
          if (event.content_block?.type === "tool_use" && event.content_block.id && event.content_block.name) {
            toolCallsWithoutArguments.add(index);
            const toolCall = {
              id: event.content_block.id,
              type: "function" as const,
              function: { name: event.content_block.name },
            };
            controller.enqueue(encodeChunk({ delta: { tool_calls: [{ index, ...toolCall }] } }));
          }
          break;
        case "content_block_delta":
          if (event.delta?.type === "text_delta" && event.delta.text) {
            controller.enqueue(encodeChunk({ delta: { content: event.delta.text } }));
          } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
            toolCallsWithoutArguments.delete(index);
            controller.enqueue(
              encodeChunk({ delta: { tool_calls: [{ index, function: { arguments: event.delta.partial_json } }] } }),
            );
          }
          break;
        case "content_block_stop":
          // A tool called without arguments streams none, where Chat Completions has an empty object
          if (toolCallsWithoutArguments.delete(index)) {
            controller.enqueue(encodeChunk({ delta: { tool_calls: [{ index, function: { arguments: "{}" } }] } }));
          }
          break;
        case "message_delta":
          stopReason = event.delta?.stop_reason ?? stopReason;
          usage = { ...usage, ...event.usage };
          break;
        case "message_stop":
          controller.enqueue(encodeChunk({ delta: {}, finish_reason: toFinishReason(stopReason) }, toUsage(usage)));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          break;
        case "error":
          controller.error(failure(event.error?.message));
          return;
      }
    }
  };

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        sseProcessor.process(bytes);
        translateEvents(controller);
      },
      flush(controller) {
        sseProcessor.flush();
        translateEvents(controller);
      },
    }),
  );
};
