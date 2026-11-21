<script setup lang="ts" generic="TMultiple extends boolean = false">
import { computed, ref, shallowRef, useAttrs, watch } from "vue";

import USelectMenu from "@nuxt/ui/components/SelectMenu.vue";

type ModelValue<M extends boolean> = M extends true ? string[] : string;

interface Item {
  value: string;
  label: string;
  icon?: string;
  description?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: ModelValue<TMultiple>;
    searchFn?: (search?: string) => Promise<string[]>;
    labelFn?: (value: string) => string;
    iconFn?: (value: string) => string | undefined;
    descriptionFn?: (value: string) => string | undefined;
    multiple?: TMultiple;
  }>(),
  {
    modelValue: undefined,
    searchFn: () => Promise.resolve([]),
    labelFn: (value: string) => value,
    iconFn: () => undefined,
    descriptionFn: () => undefined,
    // @ts-expect-error ignore wrong type
    multiple: false,
  },
);

const emit = defineEmits<(e: "update:modelValue", value: ModelValue<TMultiple>) => void>();

const attrs = useAttrs();

const search = ref<string>();
const items = shallowRef<Item[]>([]);
const loading = ref<boolean>(false);
const timer = ref<ReturnType<typeof setTimeout> | null>(null);
let latestSearch = 0;

const internalModelValue = computed({
  get: () => {
    return props.modelValue;
  },
  set: (value: ModelValue<TMultiple>) => {
    emit("update:modelValue", value);
  },
});

const getSelectedValues = (): string[] => {
  if (!props.modelValue) {
    return [];
  }
  return Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue];
};

const doSearch = async (value?: string): Promise<void> => {
  const searchId = ++latestSearch;
  try {
    loading.value = true;
    const searchResults = await props.searchFn(value);
    if (searchId !== latestSearch) {
      return;
    }
    const selectedValues = new Set(getSelectedValues());
    const selectedItems = items.value.filter((i) => selectedValues.has(i.value));
    const searchItems = searchResults.map((v) => ({
      value: v,
      label: props.labelFn(v),
      icon: props.iconFn(v),
      description: props.descriptionFn(v),
    }));
    const searchValuesSet = new Set(searchResults);
    const preservedItems = selectedItems.filter((i) => !searchValuesSet.has(i.value));
    items.value = [...preservedItems, ...searchItems];
  } catch {
    if (searchId !== latestSearch) {
      return;
    }
    const selectedValues = new Set(getSelectedValues());
    items.value = items.value.filter((i) => selectedValues.has(i.value));
  } finally {
    if (searchId === latestSearch) {
      loading.value = false;
    }
  }
};

const initializeItemsFromModel = (): void => {
  if (!props.modelValue) {
    return;
  }

  const values = Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue];
  const newItems = values.map((v) => ({
    value: v,
    label: props.labelFn(v),
    icon: props.iconFn(v),
    description: props.descriptionFn(v),
  }));

  items.value = [...items.value, ...newItems.filter((i) => !items.value.some((e) => e.value === i.value))];
};

watch(() => props.modelValue, initializeItemsFromModel, { immediate: true });

watch(search, (value) => {
  if (timer.value) {
    clearTimeout(timer.value);
  }
  timer.value = setTimeout(() => void doSearch(value), 500);
});
</script>

<template>
  <USelectMenu
    v-model="internalModelValue"
    v-model:search-term="search"
    v-bind="attrs"
    :items="items"
    value-key="value"
    :loading="loading"
    :ignore-filter="true"
    :multiple="props.multiple"
    @update:open="$event && doSearch()"
  >
    <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps || {}" />
    </template>
  </USelectMenu>
</template>
