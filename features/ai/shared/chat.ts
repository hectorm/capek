export const ChatStreamEvents = {
  Token: "token",
  Tool: "tool",
  Status: "status",
  Error: "error",
} as const;

export type ChatMessagePart =
  { type: "text"; text: string } | { type: "tool"; id: string; name: string; description: string };
