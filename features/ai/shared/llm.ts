import { z } from "zod/v4";

import { ChatToolPartSchema } from "#layers/ai/shared/chat";

// Conversation with a model, a subset of Open Responses (https://www.openresponses.org) that the API of each LLM
// provider is translated to

export const LlmItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  }),
  z.object({
    type: z.literal("reasoning"),
    content: z.string().optional(),
    encrypted_content: z.string().optional(),
  }),
  z.object({
    type: z.literal("function_call"),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
    // Markdown that shows the user what the call does
    description: z.string().optional(),
    // What the call shows the user
    parts: z.array(ChatToolPartSchema).optional(),
  }),
  z.object({
    type: z.literal("function_call_output"),
    call_id: z.string(),
    output: z.string(),
  }),
]);

export type LlmItem = z.infer<typeof LlmItemSchema>;

export const LlmToolSchema = z.object({
  type: z.literal("function"),
  name: z.string(),
  description: z.string().optional(),
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }),
});

export type LlmTool = z.infer<typeof LlmToolSchema>;

export const LlmRequestSchema = z.object({
  model: z.string().min(1).optional(),
  input: z.array(LlmItemSchema).min(1),
  stream: z.boolean().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  reasoning: z.object({ effort: z.string().min(1) }).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  tools: z.array(LlmToolSchema).optional(),
});

export type LlmRequest = z.infer<typeof LlmRequestSchema>;

export const LlmIncompleteDetailsSchema = z.object({
  reason: z.enum(["max_output_tokens", "content_filter"]),
  message: z.string().optional(),
});

export type LlmIncompleteDetails = z.infer<typeof LlmIncompleteDetailsSchema>;

export const LlmResponseSchema = z.object({
  output: z.array(LlmItemSchema),
  incomplete_details: LlmIncompleteDetailsSchema.optional(),
});

export type LlmResponse = z.infer<typeof LlmResponseSchema>;

export const LlmStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("response.output_text.delta"),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("response.completed"),
    response: LlmResponseSchema,
  }),
]);

export type LlmStreamEvent = z.infer<typeof LlmStreamEventSchema>;
