import { z } from "zod/v4";

// =============================================================================
// Tools & Functions
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
    strict: z.boolean().optional(),
  }),
});

export type OpenAITool = z.infer<typeof OpenAIToolSchema>;

export const OpenAIToolChoiceSchema = z.union([
  z.literal("none"),
  z.literal("auto"),
  z.literal("required"),
  z.object({
    type: z.literal("function"),
    function: z.object({
      name: z.string(),
    }),
  }),
]);

export type OpenAIToolChoice = z.infer<typeof OpenAIToolChoiceSchema>;

export const OpenAIToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function").optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

export type OpenAIToolCall = z.infer<typeof OpenAIToolCallSchema>;

// =============================================================================
// Messages
// =============================================================================

export const OpenAIMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "developer"]),
  content: z.string().nullish(),
  tool_calls: z.array(OpenAIToolCallSchema).nullish(),
  tool_call_id: z.string().nullish(),
  name: z.string().nullish(),
  refusal: z.string().nullish(),
});

export type OpenAIMessage = z.infer<typeof OpenAIMessageSchema>;

// =============================================================================
// Requests
// =============================================================================

export const OpenAICompletionRequestSchema = z.object({
  model: z.string().min(1).optional(),
  messages: z.array(OpenAIMessageSchema).min(1),
  stream: z.boolean().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  tools: z.array(OpenAIToolSchema).optional(),
  tool_choice: OpenAIToolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
  seed: z.number().int().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  user: z.string().optional(),
});

export type OpenAICompletionRequest = z.infer<typeof OpenAICompletionRequestSchema>;

// =============================================================================
// Responses
// =============================================================================

export const OpenAIUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});

export type OpenAIUsage = z.infer<typeof OpenAIUsageSchema>;

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
          content: z.string().nullish(),
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
  index: z.number().optional(),
  id: z.string().optional(),
  type: z.literal("function").optional(),
  function: z
    .object({
      name: z.string().optional(),
      arguments: z.string().optional(),
    })
    .optional(),
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
        role: z.string().optional(),
        content: z.string().nullish(),
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
