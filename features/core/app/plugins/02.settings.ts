import { defineNuxtPlugin, useNuxtApp } from "nuxt/app";

import { useSettingsStore } from "#layers/core/app/stores/settings";

export default defineNuxtPlugin(async () => {
  const nuxtApp = useNuxtApp();
  const settingsStore = useSettingsStore(nuxtApp.$pinia);

  if (!settingsStore.settings) {
    try {
      await settingsStore.fetch();
    } catch (error) {
      if (import.meta.client) {
        console.error(error);
      }
    }
  }
});
