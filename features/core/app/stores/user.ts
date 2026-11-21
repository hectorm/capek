import type { Ref } from "vue";
import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { ref } from "vue";

import type { RouterOutputs } from "#layers/core/app/types/trpc";

type CurrentUser = RouterOutputs["user"]["readOwn"];

export interface UserStore {
  user: Ref<CurrentUser>;
  loading: Ref<boolean>;
  fetch: () => Promise<void>;
}

export const useUserStore = defineStore("user", (): UserStore => {
  const { $trpc } = useNuxtApp();

  const user = ref<CurrentUser>(null);
  const loading = ref<boolean>(false);

  const fetch = async (): Promise<void> => {
    loading.value = true;

    try {
      const result = await $trpc.user.readOwn.query();
      user.value = result;
    } catch (error) {
      user.value = null;
      throw new Error("Failed to fetch user", { cause: error });
    } finally {
      loading.value = false;
    }
  };

  return {
    user,
    loading,
    fetch,
  };
});
