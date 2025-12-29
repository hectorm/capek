import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "~~/server/trpc/routers";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
