import { z } from "zod/v4";

// =============================================================================
// Chat Completions API
// =============================================================================

export const OpenAIFunctionParametersSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), z.any()).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

export type OpenAIFunctionParameters = z.infer<typeof OpenAIFunctionParametersSchema>;

export const OpenAIToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: OpenAIFunctionParametersSchema.optional(),
  }),
});

export type OpenAITool = z.infer<typeof OpenAIToolSchema>;

export const OpenAIToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function").optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
  extra_content: z.record(z.string(), z.unknown()).nullish(),
});

export type OpenAIToolCall = z.infer<typeof OpenAIToolCallSchema>;

export const OpenAIMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "developer"]),
  content: z.string().nullish(),
  tool_calls: z.array(OpenAIToolCallSchema).nullish(),
  tool_call_id: z.string().nullish(),
  name: z.string().nullish(),
  refusal: z.string().nullish(),
});

export type OpenAIMessage = z.infer<typeof OpenAIMessageSchema>;

export const OpenAICompletionRequestSchema = z.object({
  model: z.string().min(1).optional(),
  messages: z.array(OpenAIMessageSchema).min(1),
  stream: z.boolean().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  reasoning_effort: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  tools: z.array(OpenAIToolSchema).optional(),
});

export type OpenAICompletionRequest = z.infer<typeof OpenAICompletionRequestSchema>;

export const OpenAIUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});

export type OpenAIUsage = z.infer<typeof OpenAIUsageSchema>;

const OpenAIContentSchema = z.union([
  z.string(),
  z.array(z.object({ type: z.string(), text: z.string().nullish() })).transform((parts) =>
    parts
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join(""),
  ),
]);

export const OpenAICompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number(),
  model: z.string(),
  system_fingerprint: z.string().nullish(),
  choices: z
    .array(
      z.object({
        index: z.number(),
        message: z.object({
          role: z.string(),
          content: OpenAIContentSchema.nullish(),
          refusal: z.string().nullish(),
          tool_calls: z.array(OpenAIToolCallSchema).nullish(),
        }),
        finish_reason: z.string().nullish(),
        logprobs: z.any().nullish(),
      }),
    )
    .min(1),
  usage: OpenAIUsageSchema.nullish(),
});

export type OpenAICompletionResponse = z.infer<typeof OpenAICompletionResponseSchema>;

export const OpenAIStreamDeltaToolCallSchema = z.object({
  index: z.number().nullish(),
  id: z.string().nullish(),
  type: z.literal("function").nullish(),
  function: z
    .object({
      name: z.string().nullish(),
      arguments: z.string().nullish(),
    })
    .nullish(),
  extra_content: z.record(z.string(), z.unknown()).nullish(),
});

export type OpenAIStreamDeltaToolCall = z.infer<typeof OpenAIStreamDeltaToolCallSchema>;

export const OpenAIStreamChunkSchema = z.object({
  id: z.string().optional(),
  object: z.union([z.literal("chat.completion.chunk"), z.literal("")]),
  created: z.number(),
  model: z.string(),
  system_fingerprint: z.string().nullish(),
  choices: z.array(
    z.object({
      index: z.number(),
      delta: z.object({
        role: z.string().nullish(),
        content: OpenAIContentSchema.nullish(),
        refusal: z.string().nullish(),
        tool_calls: z.array(OpenAIStreamDeltaToolCallSchema).nullish(),
      }),
      finish_reason: z.string().nullish(),
      logprobs: z.any().nullish(),
    }),
  ),
  usage: OpenAIUsageSchema.nullish(),
  prompt_filter_results: z.array(z.unknown()).optional(),
});

export type OpenAIStreamChunk = z.infer<typeof OpenAIStreamChunkSchema>;

// =============================================================================
// Responses API
// =============================================================================

export const OpenAIResponsesToolSchema = z.object({
  type: z.literal("function"),
  name: z.string(),
  description: z.string().optional(),
  parameters: OpenAIFunctionParametersSchema.optional(),
  strict: z.boolean().optional(),
});

export type OpenAIResponsesTool = z.infer<typeof OpenAIResponsesToolSchema>;

export const OpenAIResponsesInputItemSchema = z.union([
  z.object({
    type: z.literal("message"),
    role: z.enum(["system", "user", "assistant", "developer"]),
    content: z.string(),
  }),
  z.object({
    type: z.literal("reasoning"),
    summary: z.array(z.object({ type: z.literal("summary_text"), text: z.string() })),
    content: z.array(z.object({ type: z.literal("reasoning_text"), text: z.string() })).optional(),
    encrypted_content: z.string().optional(),
  }),
  z.object({
    type: z.literal("function_call"),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal("function_call_output"),
    call_id: z.string(),
    output: z.string(),
  }),
]);

export type OpenAIResponsesInputItem = z.infer<typeof OpenAIResponsesInputItemSchema>;

export const OpenAIResponsesRequestSchema = z.object({
  model: z.string().min(1).optional(),
  input: z.array(OpenAIResponsesInputItemSchema).min(1),
  stream: z.boolean().optional(),
  store: z.boolean().optional(),
  include: z.array(z.string()).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  reasoning: z.object({ effort: z.string().min(1) }).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  tools: z.array(OpenAIResponsesToolSchema).optional(),
});

export type OpenAIResponsesRequest = z.infer<typeof OpenAIResponsesRequestSchema>;

export const OpenAIResponsesOutputItemSchema = z.object({
  type: z.string(),
  content: z.array(z.object({ type: z.string(), text: z.string().nullish(), refusal: z.string().nullish() })).nullish(),
  encrypted_content: z.string().nullish(),
  call_id: z.string().nullish(),
  name: z.string().nullish(),
  arguments: z.string().nullish(),
});

export type OpenAIResponsesOutputItem = z.infer<typeof OpenAIResponsesOutputItemSchema>;

export const OpenAIResponsesUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  total_tokens: z.number(),
});

export type OpenAIResponsesUsage = z.infer<typeof OpenAIResponsesUsageSchema>;

export const OpenAIResponsesResponseSchema = z.object({
  id: z.string(),
  created_at: z.number().nullish(),
  model: z.string(),
  status: z.string().nullish(),
  error: z.object({ message: z.string().nullish() }).nullish(),
  incomplete_details: z.object({ reason: z.string().nullish() }).nullish(),
  output: z.array(OpenAIResponsesOutputItemSchema),
  usage: OpenAIResponsesUsageSchema.nullish(),
});

export type OpenAIResponsesResponse = z.infer<typeof OpenAIResponsesResponseSchema>;

export const OpenAIResponsesStreamEventSchema = z.object({
  type: z.string(),
  output_index: z.number().nullish(),
  delta: z.string().nullish(),
  item: OpenAIResponsesOutputItemSchema.nullish(),
  // Some providers only send the whole response in the last event
  response: OpenAIResponsesResponseSchema.partial().nullish(),
  message: z.string().nullish(),
  error: z.object({ message: z.string().nullish() }).nullish(),
});

export type OpenAIResponsesStreamEvent = z.infer<typeof OpenAIResponsesStreamEventSchema>;

// =============================================================================
// Models API
// =============================================================================

export const OpenAIModelsResponseSchema = z.object({
  object: z.literal("list").optional(),
  data: z.array(
    z.object({
      id: z.string(),
      object: z.literal("model").optional(),
      created: z.number().optional(),
      owned_by: z.string().optional(),
    }),
  ),
});

export type OpenAIModelsResponse = z.infer<typeof OpenAIModelsResponseSchema>;
