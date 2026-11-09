import type { H3Event } from "h3";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

import type { PermissionName } from "#layers/core/shared/rbac";
import { can, canAny } from "#layers/core/server/lib/authz/permissions";

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
  isDev: import.meta.dev,
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

export const ensureUniqueRouters = (routerRecords: readonly Record<string, unknown>[]): void => {
  const names = new Set<string>();
  for (const name of routerRecords.flatMap((routers) => Object.keys(routers))) {
    if (names.has(name)) {
      throw new Error(`Duplicate tRPC router "${name}"`);
    }
    names.add(name);
  }
};

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
