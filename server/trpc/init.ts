import type { H3Event } from "h3";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

import type { PermissionName } from "~~/shared/rbac";
import { can, canAny } from "~~/server/lib/authz/permissions";

export const createTRPCContext = (event: H3Event) => {
  return {
    ...event.context,
    logger: event.context.logger,
    user: event.context.user,
  };
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

const authnMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    ctx.logger.warn("Authentication required but no user in context");
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

const authzMiddleware = (permissions: PermissionName[], strict = false) => {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      ctx.logger.warn("Authentication required but no user in context");
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    if (!(strict ? can : canAny)(ctx.user, permissions)) {
      ctx.logger.warn({ userId: ctx.user.id, permissions, strict }, "Permission denied");
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Insufficient permissions",
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  });
};

export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(authnMiddleware);
export const authorizedProcedure = (permissions: PermissionName[]) => t.procedure.use(authzMiddleware(permissions));
