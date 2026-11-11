import type { ToolPart } from "#layers/core/shared/tools";

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

export type ChatMessagePart =
  { type: "text"; text: string } | { type: "tool"; id: string; name: string; description: string } | ToolPart;
