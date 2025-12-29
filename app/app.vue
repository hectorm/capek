<script setup lang="ts">
import { breakpointsTailwind, provideSSRWidth } from "@vueuse/core";
import { useHeadSafe, useSeoMeta } from "nuxt/app";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { z } from "zod/v4";

import type { ToasterProps } from "@nuxt/ui";
import UApp from "@nuxt/ui/components/App.vue";
import * as locales from "@nuxt/ui/locale";

import { useDevice } from "~/composables/device";
import { useSettingsStore } from "~/stores/settings";

const route = useRoute();

const i18n = useI18n();
const settingsStore = useSettingsStore();
const locale = computed(() => locales[i18n.locale.value]);

z.config((i18n.locale.value in z.locales ? z.locales[i18n.locale.value] : z.locales.en)());

const { isMobile } = useDevice();
provideSSRWidth(isMobile ? breakpointsTailwind.md : breakpointsTailwind.lg);

const toaster: ToasterProps = {
  position: "top-right",
  duration: 2000,
};

useHeadSafe(
  computed(() => ({
    htmlAttrs: { lang: locale.value.code, dir: locale.value.dir },
    meta: [{ charset: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }],
    link: [{ rel: "icon", href: "/api/branding/icon" }],
  })),
);

useSeoMeta({
  title: () => {
    const appName = settingsStore.get("branding.name")?.value ?? "";
    const pageTitle = i18n.t(typeof route.meta.title === "string" ? route.meta.title : "layouts.default.title");
    return appName === pageTitle ? pageTitle : `${pageTitle} - ${appName}`;
  },
  description: () => {
    return i18n.t(typeof route.meta.description === "string" ? route.meta.description : "layouts.default.description");
  },
});
</script>

<template>
  <UApp :locale="locale" :toaster="toaster">
    <NuxtRouteAnnouncer />
    <NuxtLoadingIndicator />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
