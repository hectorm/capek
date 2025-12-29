import { useNuxtApp } from "nuxt/app";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export const useAgentStore = defineStore("agent", () => {
  const { $trpc } = useNuxtApp();

  const agents = ref<Awaited<ReturnType<typeof $trpc.agent.listInvocable.query>>>([]);
  const isLoaded = ref(false);

  const hasAgents = computed(() => agents.value.length > 0);

  const fetch = async (): Promise<void> => {
    if (isLoaded.value) return;

    try {
      agents.value = await $trpc.agent.listInvocable.query();
    } catch (error) {
      agents.value = [];
      throw error;
    } finally {
      isLoaded.value = true;
    }
  };

  return {
    agents,
    isLoaded,
    hasAgents,
    fetch,
  };
});
