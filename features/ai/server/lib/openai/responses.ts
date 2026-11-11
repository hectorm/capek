import type { LlmItem, LlmRequest, LlmResponse, LlmStreamEvent } from "#layers/ai/shared/llm";
import type {
  OpenAIResponsesInputItem,
  OpenAIResponsesOutputItem,
  OpenAIResponsesRequest,
} from "#layers/ai/shared/openai";
import { SSEProcessor } from "#layers/ai/server/lib/sse";
import { OpenAIResponsesResponseSchema, OpenAIResponsesStreamEventSchema } from "#layers/ai/shared/openai";

const failure = (message?: string | null): Error =>
  new Error(`AI service completion request failed: ${message ?? "unknown error"}`);

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

  return { output: fromOutput(response.output) };
};

// Translates the events of a streamed response of the Responses API
export const fromResponsesStream = (stream: ReadableStream<Uint8Array>): ReadableStream<LlmStreamEvent> => {
  const pendingEvents: string[] = [];
  const sseProcessor = new SSEProcessor({ onEvent: (event) => pendingEvents.push(event.data) });

  const translateEvents = (controller: TransformStreamDefaultController<LlmStreamEvent>): void => {
    for (const data of pendingEvents.splice(0)) {
      let rawEvent: unknown;
      try {
        rawEvent = JSON.parse(data);
      } catch {
        continue;
      }
      const parsed = OpenAIResponsesStreamEventSchema.safeParse(rawEvent);
      if (!parsed.success) {
        continue;
      }

      const event = parsed.data;

      switch (event.type) {
        case "response.output_text.delta":
          if (event.delta) {
            controller.enqueue({ type: "response.output_text.delta", delta: event.delta });
          }
          break;
        case "response.completed":
        case "response.incomplete":
          controller.enqueue({
            type: "response.completed",
            response: { output: fromOutput(event.response?.output ?? []) },
          });
          break;
        case "response.failed":
          controller.error(failure(event.response?.error?.message));
          return;
        case "error":
          controller.error(failure(event.message ?? event.error?.message));
          return;
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
      },
    }),
  );
};
