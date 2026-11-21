import type { Ref } from "vue";
import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { ref } from "vue";

import type { RouterOutputs } from "#layers/core/app/types/trpc";

type SettingsListOutput = RouterOutputs["settings"]["list"];
type SettingValue = string | string[] | number | boolean | null;

export interface SettingsStore {
  settings: Ref<SettingsListOutput | null>;
  loading: Ref<boolean>;
  fetch: () => Promise<void>;
  get: <K extends keyof SettingsListOutput>(key: K) => SettingsListOutput[K] | undefined;
  set: (items: { key: string; value: SettingValue }[]) => Promise<void>;
}

export const useSettingsStore = defineStore("settings", (): SettingsStore => {
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
    await $trpc.settings.update.mutate({ settings: items });
    await fetch();
  };

  return {
    settings,
    loading,
    fetch,
    get,
    set,
  };
});
