<script setup lang="ts">
import { computed } from "vue";

import UButton from "@nuxt/ui/components/Button.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UPopover from "@nuxt/ui/components/Popover.vue";
import USelectMenu from "@nuxt/ui/components/SelectMenu.vue";

import type { ResourceTableColumn, ResourceTableQuery } from "#layers/core/app/composables/resource-table";

import SearchMenu from "#layers/core/app/components/ui/SearchMenu.vue";

const props = defineProps<{
  column: ResourceTableColumn;
  query: ResourceTableQuery;
  label: string;
}>();

const emit = defineEmits<{
  order: [order: "asc" | "desc"];
  filter: [value: string | string[]];
}>();

const order = computed(() => (props.query.orderBy === props.column.id ? props.query.order : undefined));
const filter = computed(() => (props.query.searchBy === props.column.id ? props.query.search : undefined));
const filtered = computed(() => Boolean(filter.value?.length));
const filterValues = computed(() => (Array.isArray(filter.value) ? filter.value : []));
const filterText = computed(() => (typeof filter.value === "string" ? filter.value : ""));

const onFilterEnter = (event: KeyboardEvent): void => {
  // Enter can confirm an IME composition before the filter text is ready
  if (!event.isComposing) {
    emit("filter", (event.target as HTMLInputElement).value);
  }
};
</script>

<template>
  <UFieldGroup role="group" :aria-label="label" class="-mx-2.5 flex w-full flex-row">
    <UButton
      v-if="column.sortable"
      class="flex-1"
      :label="label"
      color="neutral"
      variant="ghost"
      :aria-label="$t('components.resourceTable.sort', { column: label })"
      :icon="
        order
          ? order === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down'
      "
      @click="emit('order', order === 'asc' ? 'desc' : 'asc')"
    />
    <UButton v-else as="span" :label="label" color="neutral" variant="ghost" class="flex-1 cursor-default" />
    <UPopover v-if="column.filterable">
      <UButton
        color="neutral"
        variant="ghost"
        :aria-label="$t('components.resourceTable.filter', { column: label })"
        :icon="filtered ? 'i-lucide-list-filter-plus' : 'i-lucide-list-filter'"
      />
      <template #content>
        <SearchMenu
          v-if="column.searchFn"
          multiple
          class="w-64"
          color="neutral"
          variant="ghost"
          icon="i-lucide-search"
          :model-value="filterValues"
          :search-fn="column.searchFn"
          :aria-label="$t('components.resourceTable.search')"
          @update:model-value="emit('filter', $event)"
        />
        <USelectMenu
          v-else-if="column.items"
          multiple
          class="w-64"
          color="neutral"
          variant="ghost"
          :items="column.items"
          :search-input="false"
          icon="i-lucide-search"
          :model-value="filterValues"
          :aria-label="$t('components.resourceTable.search')"
          @update:model-value="emit('filter', $event)"
        />
        <UInput
          v-else
          class="w-64"
          color="neutral"
          variant="ghost"
          icon="i-lucide-search"
          :model-value="filterText"
          :aria-label="$t('components.resourceTable.search')"
          @keydown.enter="onFilterEnter"
        />
      </template>
    </UPopover>
  </UFieldGroup>
</template>
