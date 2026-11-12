import type {
  AnthropicMessagesInputBlock,
  AnthropicMessagesMessage,
  AnthropicMessagesOutputBlock,
  AnthropicMessagesRequest,
} from "#layers/ai/shared/anthropic";
import type { LlmIncompleteDetails, LlmItem, LlmRequest, LlmResponse, LlmStreamEvent } from "#layers/ai/shared/llm";
import { failure } from "#layers/ai/server/lib/errors";
import { translateEventStream } from "#layers/ai/server/lib/llm/stream";
import { AgentExecutorParameters } from "#layers/ai/shared/agent";
import { AnthropicMessagesResponseSchema, AnthropicMessagesStreamEventSchema } from "#layers/ai/shared/anthropic";

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

const toBlock = (item: LlmItem): AnthropicMessagesInputBlock => {
  switch (item.type) {
    case "message":
      return { type: "text", text: item.content };
    case "reasoning":
      return item.content === undefined
        ? { type: "redacted_thinking", data: item.encrypted_content ?? "" }
        : { type: "thinking", thinking: item.content, signature: item.encrypted_content ?? "" };
    case "function_call":
      return { type: "tool_use", id: item.call_id, name: item.name, input: toToolInput(item.arguments) };
    case "function_call_output":
      return { type: "tool_result", tool_use_id: item.call_id, content: item.output };
  }
};

const fromBlock = (block: AnthropicMessagesOutputBlock): LlmItem | undefined => {
  switch (block.type) {
    case "text":
      return { type: "message", role: "assistant", content: block.text ?? "" };
    case "thinking":
      return { type: "reasoning", content: block.thinking ?? "", encrypted_content: block.signature ?? "" };
    case "redacted_thinking":
      return { type: "reasoning", encrypted_content: block.data ?? "" };
    case "tool_use":
      return block.id && block.name
        ? { type: "function_call", call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }
        : undefined;
    default:
      return undefined;
  }
};

const fromStop = (stopReason?: string | null, explanation?: string | null): LlmIncompleteDetails | undefined => {
  switch (stopReason) {
    case "refusal":
      return { reason: "content_filter", message: explanation ?? undefined };
    case "max_tokens":
    case "model_context_window_exceeded":
      return { reason: "max_output_tokens" };
    default:
      return undefined;
  }
};

const fromBlocks = (blocks: AnthropicMessagesOutputBlock[]): LlmItem[] =>
  blocks.flatMap((block) => fromBlock(block) ?? []).filter((item) => item.type !== "message" || item.content);

// Translates a request to the Messages API of Anthropic
export const toMessagesRequest = (request: LlmRequest): AnthropicMessagesRequest => {
  const system: string[] = [];
  const messages: AnthropicMessagesMessage[] = [];

  for (const item of request.input) {
    if (item.type === "message" && item.role === "system") {
      if (item.content) {
        system.push(item.content);
      }
      continue;
    }
    if (item.type === "message" && !item.content) {
      continue;
    }

    // Messages take turns starting with the user, so the results of the tools called in a turn go together
    const role =
      item.type === "function_call_output" || (item.type === "message" && item.role === "user") ? "user" : "assistant";
    const last = messages.at(-1);
    if (last?.role === role) {
      last.content.push(toBlock(item));
    } else if (last || (item.type === "message" && role === "user")) {
      messages.push({ role, content: [toBlock(item)] });
    }
  }

  // The sampling parameters and the penalties of the request have no equivalent
  return {
    model: request.model,
    system: system.length > 0 ? system.join("\n\n") : undefined,
    messages,
    stream: request.stream,
    // The limit of tokens is mandatory
    max_tokens: request.max_output_tokens ?? AgentExecutorParameters.maxTokens.default,
    output_config: request.reasoning,
    tools: request.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    })),
  };
};

// Translates a response of the Messages API
export const fromMessagesResponse = (rawResponse: unknown): LlmResponse => {
  const parsed = AnthropicMessagesResponseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(`Invalid AI service completion response format: ${parsed.error.message}`);
  }

  return {
    output: fromBlocks(parsed.data.content),
    incomplete_details: fromStop(parsed.data.stop_reason, parsed.data.stop_details?.explanation),
  };
};

// Translates the events of a streamed response of the Messages API
export const fromMessagesStream = (stream: ReadableStream<Uint8Array>): ReadableStream<LlmStreamEvent> => {
  const items = new Map<number, LlmItem>();
  let incompleteDetails: LlmIncompleteDetails | undefined;
  let completed = false;

  return translateEventStream(stream, {
    event(rawEvent) {
      const parsed = AnthropicMessagesStreamEventSchema.safeParse(rawEvent);
      if (!parsed.success) {
        return [];
      }

      const event = parsed.data;
      const index = event.index ?? 0;
      const item = items.get(index);

      switch (event.type) {
        case "content_block_start": {
          const started = event.content_block && fromBlock(event.content_block);
          if (started) {
            items.set(index, started.type === "function_call" ? { ...started, arguments: "" } : started);
          }
          return [];
        }
        case "content_block_delta":
          if (item?.type === "message" && event.delta?.text) {
            item.content += event.delta.text;
            return [{ type: "response.output_text.delta", delta: event.delta.text }];
          }
          if (item?.type === "reasoning") {
            item.content = (item.content ?? "") + (event.delta?.thinking ?? "");
            item.encrypted_content = (item.encrypted_content ?? "") + (event.delta?.signature ?? "");
          } else if (item?.type === "function_call") {
            item.arguments += event.delta?.partial_json ?? "";
          }
          return [];
        case "content_block_stop":
          // A tool called without arguments streams none
          if (item?.type === "function_call" && !item.arguments) {
            item.arguments = "{}";
          }
          return [];
        case "message_delta":
          incompleteDetails ??= fromStop(event.delta?.stop_reason, event.delta?.stop_details?.explanation);
          return [];
        case "message_stop":
          completed = true;
          return [
            {
              type: "response.completed",
              response: {
                output: Array.from(items.values()).filter((i) => i.type !== "message" || i.content),
                incomplete_details: incompleteDetails,
              },
            },
          ];
        case "error":
          throw failure(event.error?.message);
        default:
          return [];
      }
    },
    end: () => (completed ? [] : null),
  });
};
