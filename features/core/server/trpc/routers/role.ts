import { withUserTransaction } from "#layers/core/server/lib/database";
import { createTRPCRouter, protectedProcedure } from "#layers/core/server/trpc/init";

export const roleRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return withUserTransaction(ctx.user, async (trx) => {
      const roles = await trx.selectFrom("roles").select(["id", "name"]).orderBy("name", "asc").execute();

      ctx.logger.debug("Role list retrieved");
      return roles;
    });
  }),
});
