<script setup lang="ts">
import { breakpointsTailwind, createReusableTemplate, useBreakpoints, useEventListener } from "@vueuse/core";
import { useCookie, useNuxtApp } from "nuxt/app";
import { computed, provide, readonly, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { NuxtLink } from "#components";

import type { NavigationMenuItem } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UNavigationMenu from "@nuxt/ui/components/NavigationMenu.vue";
import USlideover from "@nuxt/ui/components/Slideover.vue";

import { useAppFeatures } from "#layers/core/app/composables/features";
import { ignoreClosingMenu, keepMovedFocus } from "#layers/core/app/utils/focus";
import { sidebarKey } from "#layers/core/app/utils/symbols";

import AppLogo from "#layers/core/app/components/ui/AppLogo.vue";
import UserMenu from "#layers/core/app/components/ui/UserMenu.vue";

const nuxtApp = useNuxtApp();
const i18n = useI18n();
const route = useRoute();

const { layoutSetups, navigation, sidebarSections } = useAppFeatures();

const [DefineMenu, ReuseMenu] = createReusableTemplate();

const breakpoints = useBreakpoints(breakpointsTailwind);
const lgAndLarger = breakpoints.greaterOrEqual("lg");

const sidebarOpen = useCookie(`sidebar_open`, {
  default: () => true,
  maxAge: 365 * 24 * 60 * 60,
  sameSite: "lax",
});
const slideoverOpen = ref<boolean>(false);
const page = useTemplateRef<HTMLElement>("page");
const open = computed({
  get: () => (lgAndLarger.value ? sidebarOpen.value : slideoverOpen.value),
  set: (value) => ((lgAndLarger.value ? sidebarOpen : slideoverOpen).value = value),
});

const collapsed = computed(() => lgAndLarger.value && !open.value);

const navigationItems = computed<NavigationMenuItem[]>(() => {
  return navigation.value.map((item) => ({
    label: i18n.t(item.label),
    icon: item.icon,
    to: item.to,
    exact: item.exact,
    active: item.match?.(route.path),
  }));
});

const toggle = (): void => {
  open.value = !open.value;
};
provide(sidebarKey, { open: readonly(open), toggle });

const focusContent = (): void => {
  const content = page.value?.querySelector("main") ?? page.value;
  if (!content || content.contains(document.activeElement)) {
    return;
  }

  content.tabIndex = -1;
  content.classList.add("outline-none");
  content.focus({ preventScroll: true });
};

useEventListener("pointerleave", ignoreClosingMenu, { capture: true });

for (const setup of layoutSetups) {
  setup();
}

watch(
  () => route.path,
  () => {
    if (!lgAndLarger.value && slideoverOpen.value) {
      slideoverOpen.value = false;
    }
    // A timeout lets the page focus its own control first
    nuxtApp.hooks.hookOnce("page:loading:end", () => void setTimeout(focusContent));
  },
);
</script>

<template>
  <div class="flex h-screen flex-row">
    <a
      href="#"
      class="fixed inset-s-4 top-4 z-50 rounded-md bg-default px-3 py-2 text-sm font-medium text-highlighted not-focus:sr-only"
      @click.prevent="focusContent"
    >
      {{ $t("layouts.default.skipToContent") }}
    </a>
    <DefineMenu>
      <div class="flex flex-row items-center gap-2 p-4">
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
      <div v-if="navigationItems.length > 0" class="border-b border-default px-3 py-2">
        <UNavigationMenu
          tooltip
          :collapsed="collapsed"
          orientation="vertical"
          :items="navigationItems"
          :ui="{ link: collapsed ? 'justify-center' : undefined }"
        />
      </div>
      <div class="flex min-h-0 flex-1 flex-col">
        <component :is="section.component" v-for="(section, i) in sidebarSections" :key="i" :collapsed="collapsed" />
      </div>
      <div
        :class="collapsed ? 'items-center' : 'items-stretch'"
        class="flex flex-col gap-1 border-t border-default px-3.5 py-2"
      >
        <UserMenu class="p-2" :collapsed="collapsed" />
      </div>
    </DefineMenu>
    <template v-if="lgAndLarger">
      <aside
        :style="{ 'scrollbar-width': 'thin' }"
        :aria-label="$t('layouts.default.sidebar.label')"
        :class="[collapsed ? 'max-w-16 min-w-16' : 'max-w-64 min-w-64']"
        class="hidden flex-col overflow-x-hidden border-r border-default bg-elevated/25 transition-[min-width,max-width] duration-200 ease-out motion-reduce:transition-none lg:flex"
      >
        <div class="flex h-full flex-col" :class="[collapsed ? 'w-16' : 'w-64']">
          <ReuseMenu />
        </div>
      </aside>
    </template>
    <template v-else>
      <USlideover
        v-model:open="slideoverOpen"
        side="left"
        :title="$t('layouts.default.sidebar.title')"
        :content="{ onCloseAutoFocus: keepMovedFocus }"
        :description="$t('layouts.default.sidebar.description')"
      >
        <template #content>
          <ReuseMenu />
        </template>
      </USlideover>
    </template>
    <div ref="page" class="flex min-w-0 flex-1">
      <slot />
    </div>
  </div>
</template>
