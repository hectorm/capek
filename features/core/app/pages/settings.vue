<script setup lang="ts">
import { useAppFeatures } from "#layers/core/app/composables/features";
import { definePageMeta } from "#layers/core/app/utils/page-meta";

import SectionPage from "#layers/core/app/components/ui/SectionPage.vue";

const { settingsTabs } = useAppFeatures();

// Each tab page requires its own permissions
definePageMeta({
  title: "pages.settings.title",
  description: "pages.settings.description",
});
</script>

<template>
  <SectionPage :tabs="settingsTabs" :title="$t('pages.settings.title')" />
</template>
