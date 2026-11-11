<script setup lang="ts">
import { useCookie } from "nuxt/app";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { InvocableAgent } from "#layers/ai/app/stores/agent";
import { useAgentStore } from "#layers/ai/app/stores/agent";

import SearchMenu from "#layers/core/app/components/ui/SearchMenu.vue";

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    autoSelect?: boolean;
  }>(),
  {
    modelValue: null,
    autoSelect: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string | null];
}>();

const { t } = useI18n();
const agentStore = useAgentStore();

const icons: Record<InvocableAgent["type"], string> = {
  triage: "i-lucide-workflow",
  specialist: "i-lucide-bot",
};

const selectedAgent = ref<InvocableAgent>();

const searchAgents = async (query?: string) => {
  const agents = await agentStore.search(query);
  return agents.map((agent) => agent.id);
};
const getAgentLabel = (id: string) => {
  return agentStore.get(id)?.name ?? id;
};
const getAgentIcon = (id: string) => {
  return icons[agentStore.get(id)?.type ?? "specialist"];
};
const getAgentDescription = (id: string) => {
  return agentStore.get(id)?.description;
};

const selectedAgentCookie = useCookie<string | null>("selected_agent", {
  maxAge: 365 * 24 * 60 * 60,
  sameSite: "lax",
  watch: true,
});

const selectedAgentIcon = computed(() => icons[selectedAgent.value?.type ?? "specialist"]);

watch(
  () => agentStore.isLoaded,
  async (isLoaded) => {
    if (isLoaded && props.autoSelect && !props.modelValue && agentStore.agents.length > 0) {
      const storedAgent = selectedAgentCookie.value;
      const defaultAgent = (storedAgent ? await agentStore.resolve(storedAgent) : undefined) ?? agentStore.agents[0];
      if (defaultAgent && !props.modelValue) {
        emit("update:modelValue", defaultAgent.id);
      }
    }
  },
  { immediate: true },
);

watch(
  [() => props.modelValue, () => agentStore.isLoaded],
  async ([value, isLoaded]) => {
    if (value != null) {
      selectedAgentCookie.value = value;
    }
    if (isLoaded) {
      selectedAgent.value = value != null ? await agentStore.resolve(value) : undefined;
    }
  },
  { immediate: true },
);
</script>

<template>
  <SearchMenu
    v-if="agentStore.isLoaded && agentStore.hasAgents"
    variant="ghost"
    :icon-fn="getAgentIcon"
    :icon="selectedAgentIcon"
    :label-fn="getAgentLabel"
    :search-fn="searchAgents"
    :model-value="selectedAgent?.id"
    :description-fn="getAgentDescription"
    :aria-label="t('ai.components.agentSelect.label')"
    class="hover:bg-default focus:bg-default data-[state=open]:bg-default"
    :ui="{
      content: 'w-fit max-w-[min(600px,95vw)]',
      trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
      itemDescription: 'text-wrap line-clamp-2',
    }"
    @update:model-value="(value) => emit('update:modelValue', value ?? null)"
  />
</template>
