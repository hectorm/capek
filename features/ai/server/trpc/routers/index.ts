import { agentRouter } from "#layers/ai/server/trpc/routers/agent";
import { chatMessageRouter } from "#layers/ai/server/trpc/routers/chat-message";
import { chatSessionRouter } from "#layers/ai/server/trpc/routers/chat-session";
import { chatTableRouter } from "#layers/ai/server/trpc/routers/chat-table";
import { llmProviderRouter } from "#layers/ai/server/trpc/routers/llm-provider";
import { mcpServerRouter } from "#layers/ai/server/trpc/routers/mcp-server";
import { skillRouter } from "#layers/ai/server/trpc/routers/skill";

export const routers = {
  chatSession: chatSessionRouter,
  chatMessage: chatMessageRouter,
  chatTable: chatTableRouter,
  llmProvider: llmProviderRouter,
  mcpServer: mcpServerRouter,
  skill: skillRouter,
  agent: agentRouter,
};
