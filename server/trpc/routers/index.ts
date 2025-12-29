import { createTRPCRouter } from "~~/server/trpc/init";
import { agentRouter } from "~~/server/trpc/routers/agent";
import { chatMessageRouter } from "~~/server/trpc/routers/chatMessage";
import { chatSessionRouter } from "~~/server/trpc/routers/chatSession";
import { groupRouter } from "~~/server/trpc/routers/group";
import { llmProviderRouter } from "~~/server/trpc/routers/llmProvider";
import { mcpServerRouter } from "~~/server/trpc/routers/mcpServer";
import { roleRouter } from "~~/server/trpc/routers/role";
import { settingsRouter } from "~~/server/trpc/routers/settings";
import { skillRouter } from "~~/server/trpc/routers/skill";
import { userRouter } from "~~/server/trpc/routers/user";

export const appRouter = createTRPCRouter({
  user: userRouter,
  group: groupRouter,
  role: roleRouter,
  settings: settingsRouter,
  chatSession: chatSessionRouter,
  chatMessage: chatMessageRouter,
  llmProvider: llmProviderRouter,
  mcpServer: mcpServerRouter,
  skill: skillRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;
