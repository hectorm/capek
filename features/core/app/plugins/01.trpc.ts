import { appendHeader } from "h3";
import { defineNuxtPlugin, reloadNuxtApp, useRequestEvent } from "nuxt/app";
import superjson from "superjson";
import { createTRPCNuxtClient, httpBatchLink } from "trpc-nuxt/client";

import type { AppRouter } from "#features/router";

export default defineNuxtPlugin(() => {
  const event = useRequestEvent();

  const trpc = createTRPCNuxtClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        fetchOptions: {
          onResponse: ({ response }) => {
            if (import.meta.server && event) {
              for (const cookie of response.headers.getSetCookie()) {
                appendHeader(event, "Set-Cookie", cookie);
              }
            } else if (response.status === 401) {
              reloadNuxtApp();
            }
          },
        },
      }),
    ],
  });

  return {
    provide: { trpc },
  };
});
