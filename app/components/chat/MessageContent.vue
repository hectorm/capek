<script setup lang="ts">
import { computed } from "vue";

import { mdToHtml } from "~/utils/md-to-html";

const props = defineProps<{
  text: string;
}>();

const html = computed(() => mdToHtml(props.text));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="markdown-body max-w-none" v-html="html" />
</template>
