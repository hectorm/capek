import { createTRPCNuxtHandler } from "trpc-nuxt/server";

import { appRouter } from "#features/router";

import { createTRPCContext } from "#layers/core/server/trpc/init";

export default createTRPCNuxtHandler({
  endpoint: "/api/trpc",
  router: appRouter,
  createContext: createTRPCContext,
  onError: ({ error, path, ctx }) => {
    if (error.code === "INTERNAL_SERVER_ERROR") {
      ctx?.logger.error({ path, error: error.cause ?? error }, "Procedure failed unexpectedly");
    }
  },
});
