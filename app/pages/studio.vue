<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";

import { definePageMeta } from "#imports";

import type { NavigationMenuItem } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UNavigationMenu from "@nuxt/ui/components/NavigationMenu.vue";

import { usePermissions } from "~/composables/permissions";
import { sidebarKey } from "~/utils/symbols";
import { Permissions } from "~~/shared/rbac";

const i18n = useI18n();

const sidebar = inject(sidebarKey);

const { canAny } = usePermissions();

const menu = computed<NavigationMenuItem[]>(() => {
  const menuItems: NavigationMenuItem[] = [];

  if (canAny([Permissions.AgentReadAll, Permissions.AgentReadOwn])) {
    menuItems.push({
      label: i18n.t("pages.studio.agents.tab"),
      icon: "i-lucide-bot",
      to: "/studio/agents",
    });
  }

  if (canAny([Permissions.LlmProviderReadAll, Permissions.LlmProviderReadOwn])) {
    menuItems.push({
      label: i18n.t("pages.studio.llmProviders.tab"),
      icon: "i-lucide-brain",
      to: "/studio/llmProviders",
    });
  }

  if (canAny([Permissions.McpServerReadAll, Permissions.McpServerReadOwn])) {
    menuItems.push({
      label: i18n.t("pages.studio.mcpServers.tab"),
      icon: "i-lucide-wrench",
      to: "/studio/mcpServers",
    });
  }

  if (canAny([Permissions.SkillReadAll, Permissions.SkillReadOwn])) {
    menuItems.push({
      label: i18n.t("pages.studio.skills.tab"),
      icon: "i-lucide-code",
      to: "/studio/skills",
    });
  }

  return menuItems;
});

definePageMeta({
  title: "pages.studio.title",
  description: "pages.studio.description",
  permissions: [
    Permissions.AgentCreate,
    Permissions.LlmProviderCreate,
    Permissions.McpServerCreate,
    Permissions.SkillCreate,
  ],
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
      <h1 class="text-xl font-bold">{{ $t("pages.studio.title") }}</h1>
    </header>
    <main class="flex flex-col overflow-hidden">
      <UNavigationMenu
        highlight
        :items="menu"
        orientation="horizontal"
        highlight-color="primary"
        class="border-b border-default px-4"
      />
      <NuxtPage />
    </main>
  </div>
</template>
