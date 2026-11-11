import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { ChatMessagePart } from "#layers/ai/shared/chat";
import type { LlmItem } from "#layers/ai/shared/llm";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";

// Of the items of a message, only its text and what its tool calls say about themselves are for the user
const toParts = (content: string, items: LlmItem[]): ChatMessagePart[] => {
  const parts = items.flatMap((item): ChatMessagePart[] => {
    if (item.type === "message" && item.content) {
      return [{ type: "text", text: item.content }];
    }
    if (item.type === "function_call" && item.description) {
      return [{ type: "tool", id: item.call_id, name: item.name, description: item.description }];
    }
    return [];
  });

  return parts.length > 0 ? parts : [{ type: "text", text: content }];
};

export const chatMessageRouter = createTRPCRouter({
  list: authorizedProcedure([AiPermissions.ChatListAll, AiPermissions.ChatListOwn])
    .input(
      z.object({
        sessionId: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const messages = await trx
          .selectFrom("aiChatMessages")
          .select(["id", "sessionId", "role", "content", "items", "createdAt", "updatedAt"])
          .where("sessionId", "=", input.sessionId)
          .orderBy("createdAt", "asc")
          .execute();

        ctx.logger.debug({ sessionId: input.sessionId }, "Chat messages retrieved");
        return messages.map(({ items, ...message }) => ({ ...message, parts: toParts(message.content, items) }));
      });
    }),

  create: authorizedProcedure([AiPermissions.ChatCreate])
    .input(
      z.object({
        sessionId: z.uuid(),
        role: z.literal("user"),
        content: z.string().min(1).max(100000).trim(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const message = await trx
          .insertInto("aiChatMessages")
          .values({
            sessionId: input.sessionId,
            role: input.role,
            content: input.content,
          })
          .returning(["id", "sessionId", "role", "content", "createdAt", "updatedAt"])
          .executeTakeFirstOrThrow();

        await trx
          .updateTable("aiChatSessions")
          .set({ updatedAt: new Date() })
          .where("id", "=", input.sessionId)
          .execute();

        ctx.logger.info({ messageId: message.id, sessionId: input.sessionId }, "Chat message created");
        return { ...message, parts: toParts(message.content, []) };
      });
    }),

  update: authorizedProcedure([AiPermissions.ChatUpdateAll, AiPermissions.ChatUpdateOwn])
    .input(
      z.object({
        id: z.uuid(),
        sessionId: z.uuid(),
        content: z.string().min(1).max(100000).trim(),
      }),
    )
    .mutation(() => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Message editing is not implemented",
      });
    }),

  delete: authorizedProcedure([AiPermissions.ChatDeleteAll, AiPermissions.ChatDeleteOwn])
    .input(
      z.object({
        id: z.uuid(),
        sessionId: z.uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const message = await trx
          .selectFrom("aiChatMessages")
          .select(["id", "createdAt"])
          .where("id", "=", input.id)
          .where("sessionId", "=", input.sessionId)
          .executeTakeFirst();

        if (!message) {
          ctx.logger.warn({ messageId: input.id, sessionId: input.sessionId }, "Chat message not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chat message not found",
          });
        }

        await trx
          .deleteFrom("aiChatMessages")
          .where("sessionId", "=", input.sessionId)
          .where((eb) => eb("createdAt", ">=", message.createdAt))
          .execute();

        await trx
          .updateTable("aiChatSessions")
          .set({ updatedAt: new Date() })
          .where("id", "=", input.sessionId)
          .execute();

        ctx.logger.info({ messageId: input.id, sessionId: input.sessionId }, "Chat messages deleted from point");
      });
    }),
});
