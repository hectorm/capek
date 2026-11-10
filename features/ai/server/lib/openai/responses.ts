import type {
  OpenAICompletionRequest,
  OpenAICompletionResponse,
  OpenAIResponsesInputItem,
  OpenAIResponsesRequest,
  OpenAIResponsesResponse,
  OpenAIStreamChunk,
  OpenAIToolCall,
} from "#layers/ai/shared/openai";
import { SSEProcessor } from "#layers/ai/server/lib/sse";
import { OpenAIResponsesResponseSchema, OpenAIResponsesStreamEventSchema } from "#layers/ai/shared/openai";

const failure = (message?: string | null): Error =>
  new Error(`AI service completion request failed: ${message ?? "unknown error"}`);

const toUsage = (usage: OpenAIResponsesResponse["usage"]): OpenAICompletionResponse["usage"] =>
  usage && {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
  };

const toFinishReason = (response: Partial<OpenAIResponsesResponse>, hasToolCalls: boolean): string => {
  if (hasToolCalls) {
    return "tool_calls";
  }
  if (response.status === "incomplete") {
    return response.incomplete_details?.reason === "content_filter" ? "content_filter" : "length";
  }
  return "stop";
};

// Translates a request of Chat Completions to the Responses API (https://www.openresponses.org)
export const toResponsesRequest = (request: OpenAICompletionRequest): OpenAIResponsesRequest => {
  const input: OpenAIResponsesInputItem[] = [];

  for (const message of request.messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id ?? "",
        output: message.content ?? "",
      });
      continue;
    }
    if (message.content) {
      input.push({ type: "message", role: message.role, content: message.content });
    }
    for (const toolCall of message.tool_calls ?? []) {
      input.push({
        type: "function_call",
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      });
    }
  }

  // The seed, the stop sequences and the user of the request have no equivalent
  return {
    model: request.model,
    input,
    stream: request.stream,
    // The conversation is sent in full with every request, so the provider does not have to keep it
    store: false,
    max_output_tokens: request.max_completion_tokens,
    temperature: request.temperature,
    top_p: request.top_p,
    frequency_penalty: request.frequency_penalty,
    presence_penalty: request.presence_penalty,
    tools: request.tools?.map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ?? { type: "object", properties: {} },
      // Function tools are strict by default, unlike those of Chat Completions
      strict: tool.function.strict ?? false,
    })),
    tool_choice:
      typeof request.tool_choice === "object"
        ? { type: "function", name: request.tool_choice.function.name }
        : request.tool_choice,
    parallel_tool_calls: request.parallel_tool_calls,
  };
};

// Translates a response of the Responses API to Chat Completions
export const fromResponsesResponse = (rawResponse: unknown): OpenAICompletionResponse => {
  const parsed = OpenAIResponsesResponseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(`Invalid AI service completion response format: ${parsed.error.message}`);
  }

  const response = parsed.data;
  if (response.status === "failed") {
    throw failure(response.error?.message);
  }

  let content = "";
  let refusal = "";
  const toolCalls: OpenAIToolCall[] = [];

  // The reasoning of the model is not part of its answer
  for (const item of response.output) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text") {
          content += part.text ?? "";
        } else if (part.type === "refusal") {
          refusal += part.refusal ?? "";
        }
      }
    } else if (item.type === "function_call" && item.call_id && item.name) {
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments ?? "" },
      });
    }
  }

  return {
    id: response.id,
    object: "chat.completion",
    created: response.created_at ?? 0,
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          refusal: refusal || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : null,
        },
        finish_reason: toFinishReason(response, toolCalls.length > 0),
      },
    ],
    usage: toUsage(response.usage),
  };
};

// Translates the events of a streamed response of the Responses API to the chunks of Chat Completions
export const fromResponsesStream = (stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const pendingEvents: string[] = [];
  const sseProcessor = new SSEProcessor({ onEvent: (event) => pendingEvents.push(event.data) });

  let id = "";
  let model = "";
  let created = 0;
  let hasToolCalls = false;

  const encodeChunk = (
    choice: Omit<OpenAIStreamChunk["choices"][number], "index">,
    usage?: OpenAIStreamChunk["usage"],
  ): Uint8Array => {
    const chunk: OpenAIStreamChunk = {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, ...choice }],
      usage,
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
      const parsed = OpenAIResponsesStreamEventSchema.safeParse(rawEvent);
      if (!parsed.success) {
        continue;
      }

      const event = parsed.data;
      const index = event.output_index ?? 0;

      switch (event.type) {
        case "response.created":
          id = event.response?.id ?? id;
          model = event.response?.model ?? model;
          created = event.response?.created_at ?? created;
          break;
        case "response.output_text.delta":
          controller.enqueue(encodeChunk({ delta: { content: event.delta ?? "" } }));
          break;
        case "response.output_item.added":
          if (event.item?.type === "function_call" && event.item.call_id && event.item.name) {
            hasToolCalls = true;
            const toolCall = { id: event.item.call_id, type: "function" as const, function: { name: event.item.name } };
            controller.enqueue(encodeChunk({ delta: { tool_calls: [{ index, ...toolCall }] } }));
          }
          break;
        case "response.function_call_arguments.delta":
          controller.enqueue(
            encodeChunk({ delta: { tool_calls: [{ index, function: { arguments: event.delta ?? "" } }] } }),
          );
          break;
        case "response.completed":
        case "response.incomplete":
          controller.enqueue(
            encodeChunk(
              { delta: {}, finish_reason: toFinishReason(event.response ?? {}, hasToolCalls) },
              toUsage(event.response?.usage),
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
