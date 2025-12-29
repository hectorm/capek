<script setup lang="ts">
import { useHead } from "nuxt/app";
import { computed } from "vue";

import { useSettingsStore } from "~/stores/settings";

const props = withDefaults(
  defineProps<{
    collapsed?: boolean;
  }>(),
  {
    collapsed: false,
  },
);

const settingsStore = useSettingsStore();

const appName = computed(() => settingsStore.get("branding.name")?.value ?? "");
const appImg = computed(() => (props.collapsed ? "/api/branding/icon" : "/api/branding/logo"));

useHead({
  link: [
    { rel: "preload", href: "/api/branding/logo", as: "image" },
    { rel: "preload", href: "/api/branding/icon", as: "image" },
  ],
});
</script>

<template>
  <img :src="appImg" :alt="appName" />
</template>
