<script setup lang="ts">
import { computed } from "vue";

import { mdToBlocks, mdToHtml } from "#layers/ai/app/utils/md-to-html";

const props = defineProps<{
  text: string;
}>();

const blocks = computed(() => mdToBlocks(props.text));
</script>

<template>
  <div class="markdown-body max-w-none">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-for="(block, index) in blocks" :key="index" v-memo="[block]" v-html="mdToHtml(block)" />
  </div>
</template>
