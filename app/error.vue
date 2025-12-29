<script setup lang="ts">
import type { NuxtError } from "nuxt/app";
import { useHeadSafe, useSeoMeta } from "nuxt/app";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import UApp from "@nuxt/ui/components/App.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import UTextarea from "@nuxt/ui/components/Textarea.vue";
import * as locales from "@nuxt/ui/locale";

defineProps<{
  error: NuxtError;
}>();

const i18n = useI18n();
const locale = computed(() => locales[i18n.locale.value]);

const dev = import.meta.dev;

useHeadSafe(
  computed(() => ({
    htmlAttrs: { lang: locale.value.code, dir: locale.value.dir },
    meta: [{ charset: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }],
    link: [{ rel: "icon", href: "/api/branding/icon" }],
  })),
);

useSeoMeta({
  title: () => i18n.t("pages.error.title"),
  description: () => i18n.t("pages.error.description"),
});
</script>

<template>
  <UApp :locale="locale">
    <div class="flex h-screen flex-col items-center justify-between gap-8 overflow-auto px-4 py-8">
      <div class="flex w-full flex-1 flex-col items-center justify-center gap-4">
        <h1 class="text-6xl font-bold text-primary">
          {{ error.statusCode }}
        </h1>
        <h2 class="text-4xl">
          {{ i18n.t(`pages.error.message.${error.statusCode}`, {}, i18n.t("pages.error.message.500")) }}
        </h2>
        <UButton to="/" size="xl" class="mt-5" variant="soft" color="primary" icon="i-lucide-arrow-left">
          {{ i18n.t("pages.error.back") }}
        </UButton>
      </div>
      <div v-if="dev" class="flex w-full flex-col items-center justify-center gap-4">
        <UTextarea
          readonly
          :rows="20"
          class="w-full"
          color="neutral"
          variant="subtle"
          :model-value="error.stack"
          :style="{ 'scrollbar-width': 'thin' }"
          :ui="{ base: 'resize-none font-mono whitespace-pre' }"
        />
      </div>
    </div>
  </UApp>
</template>
