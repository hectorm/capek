import type { ToolPart } from "#layers/core/shared/tools";

export const ChatStreamEvents = {
  Token: "token",
  Part: "part",
  Status: "status",
  Error: "error",
} as const;

export type ChatMessagePart =
  { type: "text"; text: string } | { type: "tool"; id: string; name: string; description: string } | ToolPart;
