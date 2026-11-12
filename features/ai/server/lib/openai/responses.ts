import type { LlmIncompleteDetails, LlmItem, LlmRequest, LlmResponse, LlmStreamEvent } from "#layers/ai/shared/llm";
import type {
  OpenAIResponsesInputItem,
  OpenAIResponsesOutputItem,
  OpenAIResponsesRequest,
} from "#layers/ai/shared/openai";
import { failure } from "#layers/ai/server/lib/errors";
import { translateEventStream } from "#layers/ai/server/lib/llm/stream";
import { OpenAIResponsesResponseSchema, OpenAIResponsesStreamEventSchema } from "#layers/ai/shared/openai";

const fromOutput = (items: OpenAIResponsesOutputItem[]): LlmItem[] => {
  const output: LlmItem[] = [];

  for (const item of items) {
    const text = (item.content ?? []).map((part) => part.text ?? "").join("");

    if (item.type === "message") {
      if (text) {
        output.push({ type: "message", role: "assistant", content: text });
      }
    } else if (item.type === "reasoning") {
      if (text || item.encrypted_content) {
        output.push({
          type: "reasoning",
          content: text || undefined,
          encrypted_content: item.encrypted_content ?? undefined,
        });
      }
    } else if (item.type === "function_call" && item.call_id && item.name) {
      output.push({
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments ?? "",
      });
    }
  }

  return output;
};

// Translates a request to the Responses API (https://www.openresponses.org)
export const toResponsesRequest = (request: LlmRequest): OpenAIResponsesRequest => {
  const input: OpenAIResponsesInputItem[] = [];

  for (const item of request.input) {
    switch (item.type) {
      case "message":
        if (item.content) {
          input.push({ type: "message", role: item.role, content: item.content });
        }
        break;
      case "reasoning":
        input.push({
          type: "reasoning",
          summary: [],
          content: item.content ? [{ type: "reasoning_text", text: item.content }] : undefined,
          encrypted_content: item.encrypted_content,
        });
        break;
      case "function_call":
        input.push({ type: "function_call", call_id: item.call_id, name: item.name, arguments: item.arguments });
        break;
      case "function_call_output":
        input.push({ type: "function_call_output", call_id: item.call_id, output: item.output });
        break;
    }
  }

  return {
    model: request.model,
    input,
    stream: request.stream,
    // The conversation is sent in full with every request, so the provider does not have to keep it
    store: false,
    include: ["reasoning.encrypted_content"],
    max_output_tokens: request.max_output_tokens,
    reasoning: request.reasoning,
    temperature: request.temperature,
    top_p: request.top_p,
    frequency_penalty: request.frequency_penalty,
    presence_penalty: request.presence_penalty,
    // Function tools are strict by default
    tools: request.tools?.map((tool) => ({ ...tool, strict: false })),
  };
};

const fromIncomplete = (response?: {
  incomplete_details?: { reason?: string | null } | null;
  output?: OpenAIResponsesOutputItem[] | null;
}): LlmIncompleteDetails | undefined => {
  const refusal = (response?.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => part.refusal ?? "")
    .join("");
  if (response?.incomplete_details?.reason === "content_filter" || refusal) {
    return { reason: "content_filter", message: refusal || undefined };
  }
  return response?.incomplete_details?.reason === "max_output_tokens" ? { reason: "max_output_tokens" } : undefined;
};

// Translates a response of the Responses API
export const fromResponsesResponse = (rawResponse: unknown): LlmResponse => {
  const parsed = OpenAIResponsesResponseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(`Invalid AI service completion response format: ${parsed.error.message}`);
  }

  const response = parsed.data;
  if (response.status === "failed") {
    throw failure(response.error?.message);
  }

  return { output: fromOutput(response.output), incomplete_details: fromIncomplete(response) };
};

// Translates the events of a streamed response of the Responses API
export const fromResponsesStream = (stream: ReadableStream<Uint8Array>): ReadableStream<LlmStreamEvent> => {
  let completed = false;

  return translateEventStream(stream, {
    event(rawEvent) {
      const parsed = OpenAIResponsesStreamEventSchema.safeParse(rawEvent);
      if (!parsed.success) {
        return [];
      }

      const event = parsed.data;

      switch (event.type) {
        case "response.output_text.delta":
          return event.delta ? [{ type: "response.output_text.delta", delta: event.delta }] : [];
        case "response.completed":
        case "response.incomplete":
          completed = true;
          return [
            {
              type: "response.completed",
              response: {
                output: fromOutput(event.response?.output ?? []),
                incomplete_details: fromIncomplete(event.response ?? undefined),
              },
            },
          ];
        case "response.failed":
          throw failure(event.response?.error?.message);
        case "error":
          throw failure(event.message ?? event.error?.message);
        default:
          return [];
      }
    },
    end: () => (completed ? [] : null),
  });
};
