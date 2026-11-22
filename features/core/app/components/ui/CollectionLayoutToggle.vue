<script setup lang="ts">
import { useTemplateRef } from "vue";

import UButton from "@nuxt/ui/components/Button.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";

import type { CollectionLayout } from "#layers/core/app/composables/collection-layout";

const layout = defineModel<CollectionLayout>({ required: true });

const buttons = {
  list: useTemplateRef<{ $el: HTMLElement }>("list"),
  grid: useTemplateRef<{ $el: HTMLElement }>("grid"),
};

const onArrowKey = (value: CollectionLayout): void => {
  layout.value = value;
  buttons[value].value?.$el.focus();
};
</script>

<template>
  <UFieldGroup
    role="group"
    :aria-label="$t('components.collectionLayoutToggle.layout')"
    @keydown.left.prevent="onArrowKey('list')"
    @keydown.right.prevent="onArrowKey('grid')"
  >
    <UButton
      ref="list"
      square
      color="neutral"
      icon="i-lucide-list"
      :aria-pressed="layout === 'list'"
      :tabindex="layout === 'list' ? 0 : -1"
      :variant="layout === 'grid' ? 'outline' : 'solid'"
      :title="$t('components.collectionLayoutToggle.listView')"
      :aria-label="$t('components.collectionLayoutToggle.listView')"
      @click="layout = 'list'"
    />
    <UButton
      ref="grid"
      square
      color="neutral"
      icon="i-lucide-layout-grid"
      :aria-pressed="layout === 'grid'"
      :tabindex="layout === 'grid' ? 0 : -1"
      :variant="layout === 'grid' ? 'solid' : 'outline'"
      :title="$t('components.collectionLayoutToggle.gridView')"
      :aria-label="$t('components.collectionLayoutToggle.gridView')"
      @click="layout = 'grid'"
    />
  </UFieldGroup>
</template>
