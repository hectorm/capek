<script setup lang="ts">
import { breakpointsTailwind, createReusableTemplate, useBreakpoints } from "@vueuse/core";
import { useCookie } from "nuxt/app";
import { computed, provide, readonly, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { NuxtLink } from "#components";

import type { NavigationMenuItem } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UNavigationMenu from "@nuxt/ui/components/NavigationMenu.vue";
import USlideover from "@nuxt/ui/components/Slideover.vue";

import { useAppFeatures } from "#layers/core/app/composables/features";
import { sidebarKey } from "#layers/core/app/utils/symbols";

import AppLogo from "#layers/core/app/components/ui/AppLogo.vue";
import UserMenu from "#layers/core/app/components/ui/UserMenu.vue";

const i18n = useI18n();
const route = useRoute();

const [DefineMenu, ReuseMenu] = createReusableTemplate();

const breakpoints = useBreakpoints(breakpointsTailwind);
const lgAndLarger = breakpoints.greaterOrEqual("lg");

const sidebarOpen = useCookie(`sidebar_open`, {
  default: () => true,
  maxAge: 365 * 24 * 60 * 60,
  sameSite: "lax",
});
const slideoverOpen = ref<boolean>(false);
const open = computed({
  get: () => (lgAndLarger.value ? sidebarOpen.value : slideoverOpen.value),
  set: (value) => ((lgAndLarger.value ? sidebarOpen : slideoverOpen).value = value),
});
const toggle = (): void => {
  open.value = !open.value;
};
provide(sidebarKey, { open: readonly(open), toggle });

const collapsed = computed(() => lgAndLarger.value && !open.value);

const { layoutSetups, navigation, sidebarSections } = useAppFeatures();

for (const setup of layoutSetups) {
  setup();
}

const navigationItems = computed<NavigationMenuItem[]>(() => {
  return navigation.value.map((item) => ({
    label: i18n.t(item.label),
    icon: item.icon,
    to: item.to,
    exact: item.exact,
  }));
});

watch(
  () => route.path,
  () => {
    if (!lgAndLarger.value && slideoverOpen.value) {
      slideoverOpen.value = false;
    }
  },
);
</script>

<template>
  <div class="flex h-screen flex-row">
    <DefineMenu>
      <div class="flex flex-row gap-2 p-4">
        <UButton
          v-if="!lgAndLarger"
          square
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :aria-label="$t('layouts.default.sidebar.toggle')"
          @click="() => toggle()"
        />
        <NuxtLink to="/" :aria-label="$t('layouts.default.sidebar.homeLink')">
          <AppLogo class="h-8" :collapsed="collapsed" />
        </NuxtLink>
      </div>
      <div v-if="navigationItems.length > 0" class="border-b border-default p-2">
        <UNavigationMenu :collapsed="collapsed" orientation="vertical" :items="navigationItems" />
      </div>
      <div class="flex min-h-0 flex-1 flex-col">
        <component :is="section.component" v-for="(section, i) in sidebarSections" :key="i" :collapsed="collapsed" />
      </div>
      <div class="flex flex-col items-stretch gap-1 border-t border-default px-3.5 py-2">
        <UserMenu class="p-2" :collapsed="collapsed" />
      </div>
    </DefineMenu>
    <template v-if="lgAndLarger">
      <aside
        :style="{ 'scrollbar-width': 'thin' }"
        :aria-label="$t('layouts.default.sidebar.label')"
        :class="[collapsed ? 'max-w-16 min-w-16' : 'max-w-64 min-w-64']"
        class="hidden flex-col overflow-x-hidden border-r border-default bg-elevated/25 duration-100 lg:flex"
      >
        <div class="flex h-full flex-col" :class="[collapsed ? 'min-w-16' : 'min-w-64']">
          <ReuseMenu />
        </div>
      </aside>
    </template>
    <template v-else>
      <USlideover
        v-model:open="slideoverOpen"
        side="left"
        :title="$t('layouts.default.sidebar.title')"
        :description="$t('layouts.default.sidebar.description')"
      >
        <template #content>
          <ReuseMenu />
        </template>
      </USlideover>
    </template>
    <slot />
  </div>
</template>
