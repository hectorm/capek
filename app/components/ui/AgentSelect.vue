<script setup lang="ts">
import { useCookie } from "nuxt/app";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { SelectMenuItem } from "@nuxt/ui";
import USelectMenu from "@nuxt/ui/components/SelectMenu.vue";

import { useAgentStore } from "~/stores/agent";

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

const icons: Record<(typeof agentStore.agents)[number]["type"], string> = {
  triage: "i-lucide-workflow",
  specialist: "i-lucide-bot",
};

const items = computed<SelectMenuItem[]>(() => {
  return agentStore.agents.map((a) => ({
    label: a.name,
    value: a.id,
    description: a.description,
    icon: icons[a.type],
  }));
});

const selectedAgentCookie = useCookie<string | null>("selected_agent", {
  maxAge: 365 * 24 * 60 * 60,
  sameSite: "lax",
  watch: true,
});

const selectedAgentIcon = computed(() => {
  const item = items.value.find((i) => (i as { value?: string }).value === props.modelValue);
  return (item as { icon?: string } | undefined)?.icon ?? icons.specialist;
});

watch(
  () => agentStore.isLoaded,
  (isLoaded) => {
    if (isLoaded && props.autoSelect && !props.modelValue && agentStore.agents.length > 0) {
      const storedAgent = selectedAgentCookie.value;
      const defaultAgent = agentStore.agents.find((a) => a.id === storedAgent) ? storedAgent : agentStore.agents[0]?.id;
      if (defaultAgent) {
        emit("update:modelValue", defaultAgent);
      }
    }
  },
  { immediate: true },
);

watch(
  () => props.modelValue,
  (value) => {
    if (value != null) {
      selectedAgentCookie.value = value;
    }
  },
);
</script>

<template>
  <USelectMenu
    v-if="agentStore.isLoaded && agentStore.hasAgents"
    :items="items"
    variant="ghost"
    value-key="value"
    :icon="selectedAgentIcon"
    :model-value="props.modelValue"
    :aria-label="t('components.agentSelect.label')"
    class="hover:bg-default focus:bg-default data-[state=open]:bg-default"
    :ui="{
      content: 'w-fit max-w-[min(600px,95vw)]',
      trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
      itemDescription: 'text-wrap line-clamp-2',
    }"
    @update:model-value="(value) => emit('update:modelValue', value ?? null)"
  />
</template>
