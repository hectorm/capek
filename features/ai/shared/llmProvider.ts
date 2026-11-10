import { z } from "zod/v4";

export const LlmProviderApiTypeSchema = z.enum(["chat-completions", "responses", "messages"]);

export type LlmProviderApiType = z.infer<typeof LlmProviderApiTypeSchema>;
