import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { useDb, withUserTransaction } from "~~/server/lib/database";
import { isRLSViolation } from "~~/server/lib/database/errors";
import { MCPManager } from "~~/server/lib/mcp/manager";
import { OpenAIManager } from "~~/server/lib/openai/manager";
import { authorizedProcedure, createTRPCRouter } from "~~/server/trpc/init";
import { Permissions } from "~~/shared/rbac";

export const chatSessionRouter = createTRPCRouter({
  read: authorizedProcedure([Permissions.ChatReadAll, Permissions.ChatReadOwn])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const session = await trx
          .selectFrom("chatSessions")
          .select(["id", "userId", "agentId", "title", "createdAt", "updatedAt"])
          .where("id", "=", input.id)
          .executeTakeFirst();

        if (!session) {
          ctx.logger.warn({ sessionId: input.id }, "Chat session not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chat session not found",
          });
        }

        ctx.logger.debug({ sessionId: input.id }, "Chat session retrieved");
        return session;
      });
    }),

  search: authorizedProcedure([Permissions.ChatListAll, Permissions.ChatListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["title"]).default("title"),
        order: z.enum(["asc", "desc"]).default("desc"),
        orderBy: z.enum(["title", "updatedAt", "createdAt"]).default("updatedAt"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.uuid().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx
          .selectFrom("chatSessions")
          .select(["id", "userId", "agentId", "title", "createdAt", "updatedAt"]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb("chatSessions.title", "ilike", `%${v}%`))));
        }

        // Apply cursor-based pagination
        if (cursor) {
          const cursorSession = await trx
            .selectFrom("chatSessions")
            .select(["id", orderBy])
            .where("id", "=", cursor)
            .executeTakeFirst();

          if (cursorSession) {
            if (order === "asc") {
              query = query.where((eb) =>
                eb.or([
                  eb(`chatSessions.${orderBy}`, ">", cursorSession[orderBy]),
                  eb.and([
                    eb(`chatSessions.${orderBy}`, "=", cursorSession[orderBy]),
                    eb("chatSessions.id", ">", cursorSession.id),
                  ]),
                ]),
              );
            } else {
              query = query.where((eb) =>
                eb.or([
                  eb(`chatSessions.${orderBy}`, "<", cursorSession[orderBy]),
                  eb.and([
                    eb(`chatSessions.${orderBy}`, "=", cursorSession[orderBy]),
                    eb("chatSessions.id", "<", cursorSession.id),
                  ]),
                ]),
              );
            }
          }
        }

        // Apply ordering and limit
        query = query
          .orderBy(`chatSessions.${orderBy}`, order)
          .orderBy("chatSessions.id", order)
          .limit(limit + 1);

        const sessions = await query.execute();

        let nextCursor: string | undefined = undefined;
        if (sessions.length > limit) {
          sessions.pop();
          nextCursor = sessions[sessions.length - 1]?.id;
        }

        ctx.logger.debug("Chat session list retrieved");
        return { sessions, nextCursor };
      });
    }),

  create: authorizedProcedure([Permissions.ChatCreate])
    .input(
      z.object({
        title: z.string().min(1).max(500).trim().optional(),
        agentId: z.uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const title = input.title ?? "";

      return withUserTransaction(ctx.user, async (trx) => {
        let greetingMessage: string | null = null;
        if (input.agentId) {
          const agent = await trx
            .selectFrom("agents")
            .select(["greetingMessage"])
            .where("id", "=", input.agentId)
            .executeTakeFirst();
          greetingMessage = agent?.greetingMessage ?? null;
        }

        try {
          const session = await trx
            .insertInto("chatSessions")
            .values({ userId: ctx.user.id, agentId: input.agentId ?? null, title })
            .returning(["id", "userId", "agentId", "title", "createdAt", "updatedAt"])
            .executeTakeFirstOrThrow();

          if (greetingMessage && greetingMessage.trim().length > 0) {
            await trx
              .insertInto("chatMessages")
              .values({ sessionId: session.id, role: "app", content: greetingMessage })
              .execute();
          }

          ctx.logger.info({ sessionId: session.id }, "Chat session created");
          return session;
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have access to this agent",
            });
          }
          throw error;
        }
      });
    }),

  update: authorizedProcedure([Permissions.ChatUpdateAll, Permissions.ChatUpdateOwn])
    .input(
      z.object({
        id: z.uuid(),
        title: z.string().min(1).max(500).trim().optional(),
        agentId: z.uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const updateData: { title?: string; agentId?: string | null; updatedAt: Date } = {
          updatedAt: new Date(),
        };
        if (input.title !== undefined) {
          updateData.title = input.title;
        }
        if (input.agentId !== undefined) {
          updateData.agentId = input.agentId || null;
        }

        try {
          const session = await trx
            .updateTable("chatSessions")
            .set(updateData)
            .where("id", "=", input.id)
            .returning(["id", "userId", "agentId", "title", "createdAt", "updatedAt"])
            .executeTakeFirst();

          if (!session) {
            ctx.logger.warn({ sessionId: input.id }, "Chat session not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Chat session not found or you don't have permission to update it",
            });
          }

          ctx.logger.info({ sessionId: input.id }, "Chat session updated");
          return session;
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have access to this agent",
            });
          }
          throw error;
        }
      });
    }),

  autoRename: authorizedProcedure([Permissions.ChatUpdateAll, Permissions.ChatUpdateOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { chatSession, agentId, firstUserMessageContent } = await withUserTransaction(ctx.user, async (trx) => {
        const sessionRow = await trx
          .selectFrom("chatSessions")
          .leftJoin("agents", "agents.id", "chatSessions.agentId")
          .select([
            "chatSessions.id",
            "chatSessions.userId",
            "chatSessions.agentId",
            "chatSessions.title",
            "chatSessions.createdAt",
            "chatSessions.updatedAt",
            "agents.id as accessibleAgentId",
          ])
          .where("chatSessions.id", "=", input.id)
          .executeTakeFirst();

        if (!sessionRow?.accessibleAgentId) {
          ctx.logger.warn({ sessionId: input.id }, "Chat session not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chat session not found or you don't have permission to update it",
          });
        }

        const accessibleAgentId = sessionRow.accessibleAgentId;
        const { accessibleAgentId: _accessibleAgentId, ...chatSessionRow } = sessionRow;

        const firstUserMessageRow = await trx
          .selectFrom("chatMessages")
          .select(["content"])
          .where("sessionId", "=", input.id)
          .where("role", "=", "user")
          .orderBy("createdAt", "asc")
          .limit(1)
          .executeTakeFirst();

        return {
          chatSession: chatSessionRow,
          agentId: accessibleAgentId,
          firstUserMessageContent: firstUserMessageRow?.content ?? null,
        };
      });

      if (!firstUserMessageContent) {
        ctx.logger.debug({ sessionId: input.id }, "No user message found, skipping auto-rename");
        return chatSession;
      }

      const db = await useDb();
      const agentLlmConfig = await db
        .selectFrom("agents")
        .leftJoin("llmProviders", "llmProviders.id", "agents.llmProviderId")
        .select([
          "agents.model",
          "agents.summaryModel",
          "llmProviders.apiUrl",
          "llmProviders.apiKey",
          "llmProviders.headers",
        ])
        .where("agents.id", "=", agentId)
        .executeTakeFirst();

      if (!agentLlmConfig?.apiUrl) {
        ctx.logger.debug({ sessionId: input.id }, "No LLM provider configured, skipping auto-rename");
        return chatSession;
      }

      const openAIManager = OpenAIManager.getInstance();
      const clientId = `summary-${input.id}-${String(Date.now())}`;
      const openAIClient = openAIManager.addClient(clientId, {
        apiUrl: agentLlmConfig.apiUrl,
        apiKey: agentLlmConfig.apiKey ?? "",
        headers: agentLlmConfig.headers ?? [],
        model: agentLlmConfig.model,
        summaryModel: agentLlmConfig.summaryModel,
      });

      let title: string;
      try {
        title = await openAIClient.summary(firstUserMessageContent);
        ctx.logger.debug({ sessionId: input.id }, "Chat session title summarized");
      } catch (error) {
        ctx.logger.warn({ sessionId: input.id, error }, "Failed to summarize title, using truncated message");
        const content = firstUserMessageContent.trim();
        title = content.length <= 80 ? content : content.slice(0, 77) + "...";
      } finally {
        openAIManager.removeClient(clientId);
      }

      return withUserTransaction(ctx.user, async (trx) => {
        const updatedSession = await trx
          .updateTable("chatSessions")
          .set({ title, updatedAt: new Date() })
          .where("id", "=", input.id)
          .returning(["id", "userId", "agentId", "title", "createdAt", "updatedAt"])
          .executeTakeFirst();

        if (!updatedSession) {
          ctx.logger.warn({ sessionId: input.id }, "Chat session not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chat session not found or you don't have permission to update it",
          });
        }

        ctx.logger.info({ sessionId: input.id, title }, "Chat session auto-renamed");
        return updatedSession;
      });
    }),

  delete: authorizedProcedure([Permissions.ChatDeleteAll, Permissions.ChatDeleteOwn])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await withUserTransaction(ctx.user, async (trx) => {
        const deleted = await trx
          .deleteFrom("chatSessions")
          .where("id", "=", input.id)
          .returning(["id"])
          .executeTakeFirst();

        if (!deleted) {
          ctx.logger.warn({ sessionId: input.id }, "Chat session not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chat session not found or you don't have permission to delete it",
          });
        }

        ctx.logger.info({ sessionId: input.id }, "Chat session deleted");
      });

      try {
        const mcpManager = MCPManager.getInstance();
        await mcpManager.cleanupSession(input.id);
      } catch (error) {
        ctx.logger.warn({ sessionId: input.id, error }, "Failed to cleanup MCP session");
      }
    }),
});
