<script setup lang="ts">
import { navigateTo } from "nuxt/app";
import { inject } from "vue";

import UButton from "@nuxt/ui/components/Button.vue";

import { useAppFeatures } from "#layers/core/app/composables/features";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { sidebarKey } from "#layers/core/app/utils/symbols";

import AppLogo from "#layers/core/app/components/ui/AppLogo.vue";

// Shown when no feature provides a home page the user can access
const sidebar = inject(sidebarKey);

definePageMeta({
  title: "pages.home.title",
  description: "pages.home.description",
  middleware: () => {
    const home = useAppFeatures().home.value;
    return home ? navigateTo(home, { replace: true }) : undefined;
  },
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
      <h1 class="text-xl font-bold">{{ $t("pages.home.title") }}</h1>
    </header>
    <main class="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
      <AppLogo class="h-16" />
      <p class="text-muted">{{ $t("pages.home.description") }}</p>
    </main>
  </div>
</template>
