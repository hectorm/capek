import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { withUserTransaction } from "~~/server/lib/database";
import { authorizedProcedure, createTRPCRouter } from "~~/server/trpc/init";
import { Permissions } from "~~/shared/rbac";

export const chatMessageRouter = createTRPCRouter({
  list: authorizedProcedure([Permissions.ChatListAll, Permissions.ChatListOwn])
    .input(
      z.object({
        sessionId: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const messages = await trx
          .selectFrom("chatMessages")
          .select(["id", "sessionId", "role", "content", "createdAt", "updatedAt"])
          .where("sessionId", "=", input.sessionId)
          .orderBy("createdAt", "asc")
          .execute();

        ctx.logger.debug({ sessionId: input.sessionId }, "Chat messages retrieved");
        return messages;
      });
    }),

  create: authorizedProcedure([Permissions.ChatCreate])
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
          .insertInto("chatMessages")
          .values({
            sessionId: input.sessionId,
            role: input.role,
            content: input.content,
          })
          .returning(["id", "sessionId", "role", "content", "createdAt", "updatedAt"])
          .executeTakeFirstOrThrow();

        await trx
          .updateTable("chatSessions")
          .set({ updatedAt: new Date() })
          .where("id", "=", input.sessionId)
          .execute();

        ctx.logger.info({ messageId: message.id, sessionId: input.sessionId }, "Chat message created");
        return message;
      });
    }),

  update: authorizedProcedure([Permissions.ChatUpdateAll, Permissions.ChatUpdateOwn])
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

  delete: authorizedProcedure([Permissions.ChatDeleteAll, Permissions.ChatDeleteOwn])
    .input(
      z.object({
        id: z.uuid(),
        sessionId: z.uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const message = await trx
          .selectFrom("chatMessages")
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
          .deleteFrom("chatMessages")
          .where("sessionId", "=", input.sessionId)
          .where((eb) => eb("createdAt", ">=", message.createdAt))
          .execute();

        await trx
          .updateTable("chatSessions")
          .set({ updatedAt: new Date() })
          .where("id", "=", input.sessionId)
          .execute();

        ctx.logger.info({ messageId: input.id, sessionId: input.sessionId }, "Chat messages deleted from point");
      });
    }),
});
