import type { ComputedRef, Ref } from "vue";
import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { RouterOutputs } from "#layers/core/app/types/trpc";
import { SEARCH_SUGGESTION_LIMIT } from "#layers/core/shared/pagination";

export type InvocableAgent = RouterOutputs["ai"]["agent"]["listInvocable"][number];

export interface AgentStore {
  agents: Ref<InvocableAgent[]>;
  isLoaded: Ref<boolean>;
  hasAgents: ComputedRef<boolean>;
  fetch: () => Promise<void>;
  search: (query?: string) => Promise<InvocableAgent[]>;
  get: (id: string) => InvocableAgent | undefined;
  resolve: (id: string) => Promise<InvocableAgent | undefined>;
}

export const useAgentStore = defineStore("ai.agent", (): AgentStore => {
  const { $trpc } = useNuxtApp();
  const cache = new Map<string, InvocableAgent>();

  const agents = ref<InvocableAgent[]>([]);
  const isLoaded = ref<boolean>(false);

  const hasAgents = computed(() => agents.value.length > 0);

  const search = async (query?: string): Promise<InvocableAgent[]> => {
    const found = await $trpc.ai.agent.listInvocable.query({ search: query, limit: SEARCH_SUGGESTION_LIMIT });
    found.forEach((agent) => cache.set(agent.id, agent));
    return found;
  };

  const fetch = async (): Promise<void> => {
    try {
      cache.clear();
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
