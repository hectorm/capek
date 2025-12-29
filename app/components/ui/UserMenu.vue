<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod/v4";

import { useColorMode } from "#imports";

import type { DropdownMenuItem } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UDropdownMenu from "@nuxt/ui/components/DropdownMenu.vue";

import { usePermissions } from "~/composables/permissions";
import { useUserStore } from "~/stores/user";
import { Permissions } from "~~/shared/rbac";

defineProps<{
  collapsed?: boolean;
}>();

const colorMode = useColorMode();
const i18n = useI18n();

const userStore = useUserStore();
const { user } = storeToRefs(userStore);

const { canAny } = usePermissions();

const items = computed<DropdownMenuItem[]>(() => {
  const menuItems: DropdownMenuItem[] = [];

  if (user.value) {
    menuItems.push({ type: "label", label: user.value.fullname }, { type: "separator" });
  }

  if (canAny([Permissions.AgentCreate, Permissions.LlmProviderCreate, Permissions.McpServerCreate])) {
    menuItems.push({
      type: "link",
      label: i18n.t("components.userMenu.studio.label"),
      icon: "i-lucide-sparkles",
      to: "/studio/agents",
    });
  }

  if (canAny([Permissions.SettingsReadAll])) {
    menuItems.push({
      type: "link",
      label: i18n.t("components.userMenu.settings.label"),
      icon: "i-lucide-settings",
      to: "/settings",
    });
  }

  menuItems.push({
    type: "link",
    label: i18n.t("components.userMenu.language.label"),
    icon: "i-lucide-globe",
    children: i18n.locales.value.map((l) => ({
      type: "checkbox",
      label: l.name ?? "",
      checked: i18n.locale.value === l.code,
      onSelect(e: Event) {
        e.preventDefault();
        const code = l.code as keyof typeof z.locales;
        void i18n.setLocale(code as Parameters<typeof i18n.setLocale>[0]);
        z.config((code in z.locales ? z.locales[code] : z.locales.en)());
      },
    })),
  });

  menuItems.push({
    type: "link",
    label: i18n.t("components.userMenu.theme.label"),
    icon: "i-lucide-sun-moon",
    children: ["light", "dark", "system"].map((t) => ({
      type: "checkbox",
      label: i18n.t(`components.userMenu.theme.value.${t}`),
      icon: t === "light" ? "i-lucide-sun" : t === "dark" ? "i-lucide-moon" : "i-lucide-monitor",
      checked: colorMode.preference === t,
      onSelect(e: Event) {
        e.preventDefault();
        colorMode.preference = t;
      },
    })),
  });

  menuItems.push({ type: "separator" });

  if (user.value) {
    menuItems.push({
      type: "link",
      label: i18n.t("components.userMenu.logOut.label"),
      icon: "i-lucide-log-out",
      to: "/api/logout",
      external: true,
    });
  } else {
    menuItems.push({
      type: "link",
      label: i18n.t("components.userMenu.logIn.label"),
      icon: "i-lucide-log-in",
      to: "/api/login",
      external: true,
    });
  }

  return menuItems;
});
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      :block="!collapsed"
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{ trailingIcon: 'text-dimmed' }"
      :aria-label="user?.fullname ?? i18n.t('components.userMenu.anonymous.label')"
      :trailing-icon="collapsed ? 'i-lucide-circle-user' : 'i-lucide-chevrons-up-down'"
      :label="collapsed ? undefined : (user?.fullname ?? i18n.t('components.userMenu.anonymous.label'))"
    />
    <template #chip-leading="{ item }">
      <span
        class="ms-0.5 size-2 rounded-full bg-(--chip)"
        :style="{ '--chip': `var(--color-${(item as { chip?: string }).chip}-400)` }"
      />
    </template>
  </UDropdownMenu>
</template>
