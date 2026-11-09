import { agentRouter } from "#layers/ai/server/trpc/routers/agent";
import { chatMessageRouter } from "#layers/ai/server/trpc/routers/chatMessage";
import { chatSessionRouter } from "#layers/ai/server/trpc/routers/chatSession";
import { llmProviderRouter } from "#layers/ai/server/trpc/routers/llmProvider";
import { mcpServerRouter } from "#layers/ai/server/trpc/routers/mcpServer";
import { skillRouter } from "#layers/ai/server/trpc/routers/skill";

export const routers = {
  chatSession: chatSessionRouter,
  chatMessage: chatMessageRouter,
  llmProvider: llmProviderRouter,
  mcpServer: mcpServerRouter,
  skill: skillRouter,
  agent: agentRouter,
};
