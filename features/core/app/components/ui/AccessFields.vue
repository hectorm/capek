<script setup lang="ts">
import UFormField from "@nuxt/ui/components/FormField.vue";

import type { Principal } from "#layers/core/shared/rbac";
import { usePrincipalSearch } from "#layers/core/app/composables/principal-search";

import SearchMenu from "#layers/core/app/components/ui/SearchMenu.vue";

const props = defineProps<{
  editors: string[];
  users: string[];
  // Existing principals supply labels before the first search
  access: Principal[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:editors": [value: string[]];
  "update:users": [value: string[]];
}>();

const { search, getLabel, getIcon, preload } = usePrincipalSearch();

preload(props.access);
</script>

<template>
  <UFormField name="editors" :label="$t('components.accessFields.editors.label')">
    <SearchMenu
      multiple
      class="w-full"
      :icon-fn="getIcon"
      :search-fn="search"
      :disabled="disabled"
      :label-fn="getLabel"
      :model-value="editors"
      :placeholder="$t('components.accessFields.editors.placeholder')"
      @update:model-value="emit('update:editors', $event)"
    />
  </UFormField>
  <UFormField name="users" :label="$t('components.accessFields.users.label')">
    <SearchMenu
      multiple
      class="w-full"
      :icon-fn="getIcon"
      :search-fn="search"
      :disabled="disabled"
      :label-fn="getLabel"
      :model-value="users"
      :placeholder="$t('components.accessFields.users.placeholder')"
      @update:model-value="emit('update:users', $event)"
    />
  </UFormField>
</template>
