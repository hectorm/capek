<script setup lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";

import type { CollectionLayout } from "#layers/core/app/composables/collection-layout";

const layout = defineModel<CollectionLayout>({ required: true });
</script>

<template>
  <UFieldGroup role="group" :aria-label="$t('components.collectionLayoutToggle.layout')">
    <UButton
      square
      color="neutral"
      icon="i-lucide-list"
      :aria-pressed="layout === 'list'"
      :variant="layout === 'grid' ? 'outline' : 'solid'"
      :title="$t('components.collectionLayoutToggle.listView')"
      :aria-label="$t('components.collectionLayoutToggle.listView')"
      @click="layout = 'list'"
    />
    <UButton
      square
      color="neutral"
      icon="i-lucide-layout-grid"
      :aria-pressed="layout === 'grid'"
      :variant="layout === 'grid' ? 'solid' : 'outline'"
      :title="$t('components.collectionLayoutToggle.gridView')"
      :aria-label="$t('components.collectionLayoutToggle.gridView')"
      @click="layout = 'grid'"
    />
  </UFieldGroup>
</template>
