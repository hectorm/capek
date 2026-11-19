<script setup lang="ts">
import { inject } from "vue";

import UButton from "@nuxt/ui/components/Button.vue";

import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { sidebarKey } from "#layers/core/app/utils/symbols";

import WelcomePrompt from "#layers/ai/app/components/chat/WelcomePrompt.vue";

const sidebar = inject(sidebarKey);

definePageMeta({
  title: "ai.pages.welcome.title",
  description: "ai.pages.welcome.description",
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
      <h1 class="text-xl font-bold">{{ $t("ai.pages.welcome.title") }}</h1>
    </header>
    <main class="flex flex-1 flex-col justify-center px-4 py-8">
      <WelcomePrompt />
    </main>
  </div>
</template>
