import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { LlmClient } from "#layers/ai/server/lib/llm/client";
import { MCPManager } from "#layers/ai/server/lib/mcp/manager";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { canAny } from "#layers/core/server/lib/authz/permissions";
import { useDb, withUserTransaction } from "#layers/core/server/lib/database";
import { isRLSViolation } from "#layers/core/server/lib/database/errors";
import { PageCursorSchema, paginate } from "#layers/core/server/lib/database/pagination";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";

export const chatSessionRouter = createTRPCRouter({
  read: authorizedProcedure([AiPermissions.ChatReadAll, AiPermissions.ChatReadOwn])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const session = await trx
          .selectFrom("aiChatSessions")
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

  search: authorizedProcedure([AiPermissions.ChatListAll, AiPermissions.ChatListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["title"]).default("title"),
        order: z.enum(["asc", "desc"]).default("desc"),
        orderBy: z.enum(["title", "updatedAt", "createdAt"]).default("updatedAt"),
        limit: z.number().min(1).max(100).default(50),
        cursor: PageCursorSchema.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx
          .selectFrom("aiChatSessions")
          .select(["id", "userId", "agentId", "title", "createdAt", "updatedAt"]);

        // The policy alone reads the sessions of every user to find the ones of this one
        if (!canAny(ctx.user, [AiPermissions.ChatReadAll, AiPermissions.ChatListAll])) {
          query = query.where("aiChatSessions.userId", "=", ctx.user.id);
        }

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb("aiChatSessions.title", "ilike", `%${v}%`))));
        }

        const { rows: sessions, nextCursor } = await paginate(query, {
          table: "aiChatSessions",
          orderBy,
          order,
          limit,
          cursor,
        });

        ctx.logger.debug("Chat session list retrieved");
        return { sessions, nextCursor };
      });
    }),

  create: authorizedProcedure([AiPermissions.ChatCreate])
    .input(
      z.object({
        title: z.string().trim().min(1).max(500).optional(),
        agentId: z.uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const title = input.title ?? "";

      return withUserTransaction(
        ctx.user,
        async (trx) => {
          let greetingMessage: string | null = null;
          if (input.agentId) {
            const agent = await trx
              .selectFrom("aiAgents")
              .select(["greetingMessage"])
              .where("id", "=", input.agentId)
              .executeTakeFirst();
            greetingMessage = agent?.greetingMessage ?? null;
          }

          try {
            const session = await trx
              .insertInto("aiChatSessions")
              .values({ userId: ctx.user.id, agentId: input.agentId ?? null, title })
              .returning(["id", "userId", "agentId", "title", "createdAt", "updatedAt"])
              .executeTakeFirstOrThrow();

            if (greetingMessage && greetingMessage.trim().length > 0) {
              await trx
                .insertInto("aiChatMessages")
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
        },
        { trustedWrites: true },
      );
    }),

  update: authorizedProcedure([AiPermissions.ChatUpdateAll, AiPermissions.ChatUpdateOwn])
    .input(
      z.object({
        id: z.uuid(),
        title: z.string().trim().min(1).max(500).optional(),
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
            .updateTable("aiChatSessions")
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

  autoRename: authorizedProcedure([AiPermissions.ChatUpdateAll, AiPermissions.ChatUpdateOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { chatSession, agentId, firstUserMessageContent } = await withUserTransaction(ctx.user, async (trx) => {
        const sessionRow = await trx
          .selectFrom("aiChatSessions")
          .leftJoin("aiAgents", "aiAgents.id", "aiChatSessions.agentId")
          .select([
            "aiChatSessions.id",
            "aiChatSessions.userId",
            "aiChatSessions.agentId",
            "aiChatSessions.title",
            "aiChatSessions.createdAt",
            "aiChatSessions.updatedAt",
            "aiAgents.id as accessibleAgentId",
          ])
          .where("aiChatSessions.id", "=", input.id)
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
          .selectFrom("aiChatMessages")
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

      // eslint-disable-next-line no-restricted-syntax
      const db = await useDb();
      const agentLlmConfig = await db
        .selectFrom("aiAgents")
        .leftJoin("aiLlmProviders", "aiLlmProviders.id", "aiAgents.llmProviderId")
        .select([
          "aiAgents.model",
          "aiAgents.summaryModel",
          "aiLlmProviders.apiUrl",
          "aiLlmProviders.apiType",
          "aiLlmProviders.apiKey",
          "aiLlmProviders.headers",
        ])
        .where("aiAgents.id", "=", agentId)
        .executeTakeFirst();

      if (!agentLlmConfig?.apiUrl) {
        ctx.logger.debug({ sessionId: input.id }, "No LLM provider configured, skipping auto-rename");
        return chatSession;
      }

      const llmClient = new LlmClient({
        apiUrl: agentLlmConfig.apiUrl,
        apiType: agentLlmConfig.apiType,
        apiKey: agentLlmConfig.apiKey ?? "",
        headers: agentLlmConfig.headers ?? [],
        model: agentLlmConfig.model,
        summaryModel: agentLlmConfig.summaryModel,
      });

      let title: string;
      try {
        title = await llmClient.summary(firstUserMessageContent);
        ctx.logger.debug({ sessionId: input.id }, "Chat session title summarized");
      } catch (error) {
        ctx.logger.warn({ sessionId: input.id, error }, "Failed to summarize title, using truncated message");
        const content = firstUserMessageContent.trim();
        title = content.length <= 80 ? content : `${content.slice(0, 77)}...`;
      }

      return withUserTransaction(ctx.user, async (trx) => {
        const updatedSession = await trx
          .updateTable("aiChatSessions")
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

  delete: authorizedProcedure([AiPermissions.ChatDeleteAll, AiPermissions.ChatDeleteOwn])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await withUserTransaction(ctx.user, async (trx) => {
        const deleted = await trx
          .deleteFrom("aiChatSessions")
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
