import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { ref } from "vue";

import type { RouterOutputs } from "~~/app/types/trpc";

export const useUserStore = defineStore("user", () => {
  const { $trpc } = useNuxtApp();

  const user = ref<RouterOutputs["user"]["me"]>(null);
  const loading = ref<boolean>(false);

  const fetch = async (): Promise<void> => {
    loading.value = true;

    try {
      const result = await $trpc.user.me.query();
      user.value = result;
    } catch (error) {
      user.value = null;
      throw new Error("Failed to fetch user", { cause: error });
    } finally {
      loading.value = false;
    }
  };

  const clear = (): void => {
    user.value = null;
  };

  return {
    user,
    loading,
    fetch,
    clear,
  };
});
