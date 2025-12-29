import { defineNuxtRouteMiddleware, navigateTo, useNuxtApp, useRequestURL } from "nuxt/app";

import { useUserStore } from "~/stores/user";

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith("/api/")) {
    return;
  }

  const nuxtApp = useNuxtApp();
  const userStore = useUserStore(nuxtApp.$pinia);

  if (!userStore.user) {
    try {
      await userStore.fetch();
    } catch (error) {
      console.error(error);
    }
  }

  if (!userStore.user) {
    const path = `/api/login?redirect=${encodeURIComponent(to.fullPath)}`;
    const origin = import.meta.client ? window.location.origin : useRequestURL().origin;
    return navigateTo(new URL(path, origin).href, { external: true, redirectCode: 302 });
  }
});
