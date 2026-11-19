<script setup lang="ts">
import { computed } from "vue";

import { mdToBlocks, mdToHtml } from "#layers/core/app/utils/md-to-html";
import "#layers/core/app/assets/css/markdown.css";

const props = defineProps<{
  text: string;
}>();

const blocks = computed(() => mdToBlocks(props.text));
</script>

<template>
  <div class="markdown-body max-w-none">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-for="(block, index) in blocks" :key="index" v-memo="[block]" v-html="mdToHtml(block, { breaks: true })" />
  </div>
</template>
