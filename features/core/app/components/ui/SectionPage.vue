<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { NuxtPage } from "#components";

import type { NavigationMenuItem } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";

import type { AppMenuItem } from "#layers/core/app/utils/features";
import { sidebarKey } from "#layers/core/app/utils/symbols";

import SectionTabs from "#layers/core/app/components/ui/SectionTabs.vue";

const props = defineProps<{
  title: string;
  tabs: readonly AppMenuItem[];
}>();

const i18n = useI18n();
const route = useRoute();

const sidebar = inject(sidebarKey);

const menu = computed<NavigationMenuItem[]>(() => {
  return props.tabs.map((tab) => ({
    label: i18n.t(tab.label),
    icon: tab.icon,
    to: tab.to,
    exact: tab.exact,
    active: tab.match?.(route.path),
  }));
});
</script>

<template>
  <div class="flex w-full flex-col overflow-auto">
    <header class="flex flex-row items-center gap-1.5 border-b border-default p-4">
      <UButton
        square
        color="neutral"
        variant="ghost"
        icon="i-lucide-menu"
        :aria-label="$t('layouts.default.sidebar.toggle')"
        @click="sidebar?.toggle()"
      />
      <h1 class="text-xl font-bold">{{ title }}</h1>
    </header>
    <SectionTabs :items="menu" />
    <main class="flex flex-col overflow-hidden">
      <NuxtPage />
    </main>
  </div>
</template>
