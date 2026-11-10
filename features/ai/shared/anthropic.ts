import { z } from "zod/v4";

// =============================================================================
// Messages API
// =============================================================================

export const AnthropicMessagesToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()),
  strict: z.boolean().optional(),
});

export type AnthropicMessagesTool = z.infer<typeof AnthropicMessagesToolSchema>;

export const AnthropicMessagesToolChoiceSchema = z.object({
  type: z.enum(["none", "auto", "any", "tool"]),
  name: z.string().optional(),
  disable_parallel_tool_use: z.boolean().optional(),
});

export type AnthropicMessagesToolChoice = z.infer<typeof AnthropicMessagesToolChoiceSchema>;

export const AnthropicMessagesInputBlockSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.string(),
  }),
]);

export type AnthropicMessagesInputBlock = z.infer<typeof AnthropicMessagesInputBlockSchema>;

export const AnthropicMessagesMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.array(AnthropicMessagesInputBlockSchema).min(1),
});

export type AnthropicMessagesMessage = z.infer<typeof AnthropicMessagesMessageSchema>;

export const AnthropicMessagesRequestSchema = z.object({
  model: z.string().min(1).optional(),
  system: z.string().optional(),
  messages: z.array(AnthropicMessagesMessageSchema).min(1),
  stream: z.boolean().optional(),
  max_tokens: z.number().int().positive(),
  output_config: z.object({ effort: z.string().min(1) }).optional(),
  stop_sequences: z.array(z.string()).optional(),
  metadata: z.object({ user_id: z.string() }).optional(),
  tools: z.array(AnthropicMessagesToolSchema).optional(),
  tool_choice: AnthropicMessagesToolChoiceSchema.optional(),
});

export type AnthropicMessagesRequest = z.infer<typeof AnthropicMessagesRequestSchema>;

export const AnthropicMessagesOutputBlockSchema = z.object({
  type: z.string(),
  text: z.string().nullish(),
  id: z.string().nullish(),
  name: z.string().nullish(),
  input: z.unknown().optional(),
});

export type AnthropicMessagesOutputBlock = z.infer<typeof AnthropicMessagesOutputBlockSchema>;

export const AnthropicMessagesUsageSchema = z.object({
  input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
});

export type AnthropicMessagesUsage = z.infer<typeof AnthropicMessagesUsageSchema>;

export const AnthropicMessagesResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  content: z.array(AnthropicMessagesOutputBlockSchema),
  stop_reason: z.string().nullish(),
  usage: AnthropicMessagesUsageSchema.nullish(),
});

export type AnthropicMessagesResponse = z.infer<typeof AnthropicMessagesResponseSchema>;

export const AnthropicMessagesStreamEventSchema = z.object({
  type: z.string(),
  index: z.number().nullish(),
  message: AnthropicMessagesResponseSchema.partial().nullish(),
  content_block: AnthropicMessagesOutputBlockSchema.nullish(),
  delta: z
    .object({
      type: z.string().nullish(),
      text: z.string().nullish(),
      partial_json: z.string().nullish(),
      stop_reason: z.string().nullish(),
    })
    .nullish(),
  usage: AnthropicMessagesUsageSchema.nullish(),
  error: z.object({ message: z.string().nullish() }).nullish(),
});

export type AnthropicMessagesStreamEvent = z.infer<typeof AnthropicMessagesStreamEventSchema>;
