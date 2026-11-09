import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "#features/router";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
