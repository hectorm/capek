import { z } from "zod/v4";

import { ChartPartSchema, TablePartSchema } from "#layers/core/shared/tools";

export const ChatStreamEvents = {
  Token: "token",
  Part: "part",
  Status: "status",
  Error: "error",
} as const;

export const ChatStreamErrors = {
  Failed: "failed",
  Timeout: "timeout",
  MaxIterations: "maxIterations",
  Refusal: "refusal",
  MaxOutputTokens: "maxOutputTokens",
} as const;

export type ChatStreamError = (typeof ChatStreamErrors)[keyof typeof ChatStreamErrors];

export const ChatChartPartSchema = ChartPartSchema;

export type ChatChartPart = z.infer<typeof ChatChartPartSchema>;

export const ChatTablePartSchema = TablePartSchema.extend({
  id: z.uuid(),
  rowCount: z.number().int(),
});

export type ChatTablePart = z.infer<typeof ChatTablePartSchema>;

export const ChatToolPartSchema = z.discriminatedUnion("type", [ChatChartPartSchema, ChatTablePartSchema]);

export type ChatToolPart = z.infer<typeof ChatToolPartSchema>;

export type ChatMessagePart =
  { type: "text"; text: string } | { type: "tool"; id: string; name: string; description: string } | ChatToolPart;
