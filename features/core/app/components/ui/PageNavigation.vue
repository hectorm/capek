<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import type { NavigationMenuItem } from "@nuxt/ui";
import UNavigationMenu from "@nuxt/ui/components/NavigationMenu.vue";

import { useAppFeatures } from "#layers/core/app/composables/features";

defineProps<{ collapsed?: boolean }>();

const i18n = useI18n();
const route = useRoute();
const { navigation } = useAppFeatures();

const items = computed<NavigationMenuItem[]>(() => {
  return navigation.value.map((item) => ({
    label: i18n.t(item.label),
    icon: item.icon,
    to: item.to,
    exact: item.exact,
    active: item.match?.(route.path),
  }));
});
</script>

<template>
  <UNavigationMenu
    v-if="items.length"
    tooltip
    :items="items"
    :collapsed="collapsed"
    orientation="vertical"
    class="shrink-0 px-3 py-2"
    :aria-label="$t('components.pageNavigation.label')"
    :ui="collapsed ? { link: 'justify-center', linkLabel: 'sr-only block' } : undefined"
  />
</template>
