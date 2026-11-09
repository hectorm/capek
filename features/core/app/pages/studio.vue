<script setup lang="ts">
import { useAppFeatures } from "#layers/core/app/composables/features";
import { definePageMeta } from "#layers/core/app/utils/page-meta";

import SectionPage from "#layers/core/app/components/ui/SectionPage.vue";

const { studioTabs } = useAppFeatures();

// Each tab page requires its own permissions
definePageMeta({
  title: "pages.studio.title",
  description: "pages.studio.description",
});
</script>

<template>
  <SectionPage :tabs="studioTabs" :title="$t('pages.studio.title')" />
</template>
