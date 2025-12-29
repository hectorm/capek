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

  if (canAny([Permissions.SettingsReadAll])) {
    menuItems.push({
      label: i18n.t("pages.settings.general.tab"),
      icon: "i-lucide-settings-2",
      to: "/settings",
      exact: true,
    });
  }

  if (canAny([Permissions.UserReadAll])) {
    menuItems.push({
      label: i18n.t("pages.settings.users.tab"),
      icon: "i-lucide-user",
      to: "/settings/users",
    });
  }

  if (canAny([Permissions.GroupReadAll])) {
    menuItems.push({
      label: i18n.t("pages.settings.groups.tab"),
      icon: "i-lucide-users",
      to: "/settings/groups",
    });
  }

  return menuItems;
});

definePageMeta({
  title: "pages.settings.title",
  description: "pages.settings.description",
  permissions: [Permissions.SettingsReadAll, Permissions.UserReadAll, Permissions.GroupReadAll],
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
      <h1 class="text-xl font-bold">{{ $t("pages.settings.title") }}</h1>
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
