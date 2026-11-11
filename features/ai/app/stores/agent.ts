import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { RouterOutputs } from "#layers/core/app/types/trpc";

export type InvocableAgent = RouterOutputs["ai"]["agent"]["listInvocable"][number];

export const useAgentStore = defineStore("ai.agent", () => {
  const { $trpc } = useNuxtApp();
  const cache = new Map<string, InvocableAgent>();

  const agents = ref<InvocableAgent[]>([]);
  const isLoaded = ref(false);

  const hasAgents = computed(() => agents.value.length > 0);

  const search = async (query?: string): Promise<InvocableAgent[]> => {
    const found = await $trpc.ai.agent.listInvocable.query({ search: query, limit: 25 });
    found.forEach((agent) => cache.set(agent.id, agent));
    return found;
  };

  const fetch = async (): Promise<void> => {
    if (isLoaded.value) return;

    try {
      agents.value = await search();
    } catch (error) {
      agents.value = [];
      throw error;
    } finally {
      isLoaded.value = true;
    }
  };

  const get = (id: string): InvocableAgent | undefined => {
    return cache.get(id);
  };

  const resolve = async (id: string): Promise<InvocableAgent | undefined> => {
    if (!cache.has(id)) {
      const [agent] = await $trpc.ai.agent.listInvocable.query({ id });
      if (agent) {
        cache.set(id, agent);
      }
    }
    return cache.get(id);
  };

  return {
    agents,
    isLoaded,
    hasAgents,
    fetch,
    search,
    get,
    resolve,
  };
});
