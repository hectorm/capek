import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { ref } from "vue";

import type { RouterOutputs } from "~/types/trpc";

type SettingsListOutput = RouterOutputs["settings"]["list"];
type SettingValue = string | string[] | number | boolean | null;

export const useSettingsStore = defineStore("settings", () => {
  const { $trpc } = useNuxtApp();

  const settings = ref<SettingsListOutput | null>(null);
  const loading = ref<boolean>(false);

  const fetch = async (): Promise<void> => {
    try {
      loading.value = true;
      settings.value = await $trpc.settings.list.query();
    } catch (error) {
      settings.value = null;
      throw new Error("Failed to fetch settings", { cause: error });
    } finally {
      loading.value = false;
    }
  };

  const get = <K extends keyof SettingsListOutput>(key: K): SettingsListOutput[K] | undefined => {
    return settings.value?.[key];
  };

  const set = async (items: { key: string; value: SettingValue }[]): Promise<void> => {
    await $trpc.settings.upsert.mutate(items);
    await fetch();
  };

  const clear = (): void => {
    settings.value = null;
  };

  return {
    settings,
    loading,
    fetch,
    get,
    set,
    clear,
  };
});
