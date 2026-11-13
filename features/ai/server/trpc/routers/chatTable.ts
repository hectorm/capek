import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { loadTable } from "#layers/ai/server/lib/tables";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";

export const chatTableRouter = createTRPCRouter({
  read: authorizedProcedure([AiPermissions.ChatReadAll, AiPermissions.ChatReadOwn])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const table = await loadTable(input.id, ctx.user);

      if (!table) {
        ctx.logger.warn({ tableId: input.id }, "Chat table not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chat table not found",
        });
      }

      ctx.logger.debug({ tableId: input.id }, "Chat table retrieved");
      return table;
    }),
});
