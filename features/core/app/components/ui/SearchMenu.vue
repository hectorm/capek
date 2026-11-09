<script setup lang="ts" generic="TMultiple extends boolean = false">
import { computed, ref, shallowRef, useAttrs, watch } from "vue";

import USelectMenu from "@nuxt/ui/components/SelectMenu.vue";

type ModelValue<M extends boolean> = M extends true ? string[] : string;

interface Item {
  value: string;
  label: string;
  icon?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: ModelValue<TMultiple>;
    searchFn?: (search?: string) => Promise<string[]>;
    labelFn?: (value: string) => string;
    iconFn?: (value: string) => string | undefined;
    multiple?: TMultiple;
  }>(),
  {
    modelValue: undefined,
    searchFn: () => Promise.resolve([]),
    labelFn: (value: string) => value,
    iconFn: () => undefined,
    // @ts-expect-error ignore wrong type
    multiple: false,
  },
);

const emit = defineEmits<(e: "update:modelValue", value: ModelValue<TMultiple>) => void>();

const search = ref<string>();
const items = shallowRef<Item[]>([]);
const loading = ref<boolean>(false);
const timer = ref<ReturnType<typeof setTimeout> | null>(null);

const getSelectedValues = (): string[] => {
  if (!props.modelValue) return [];
  return Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue];
};

const doSearch = async (value?: string) => {
  try {
    loading.value = true;
    const searchResults = await props.searchFn(value);
    const selectedValues = new Set(getSelectedValues());
    const selectedItems = items.value.filter((i) => selectedValues.has(i.value));
    const searchItems = searchResults.map((v) => ({
      value: v,
      label: props.labelFn(v),
      icon: props.iconFn(v),
    }));
    const searchValuesSet = new Set(searchResults);
    const preservedItems = selectedItems.filter((i) => !searchValuesSet.has(i.value));
    items.value = [...preservedItems, ...searchItems];
  } catch {
    const selectedValues = new Set(getSelectedValues());
    items.value = items.value.filter((i) => selectedValues.has(i.value));
  } finally {
    loading.value = false;
  }
};

const initializeItemsFromModel = () => {
  if (!props.modelValue) return;

  const values = Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue];
  const newItems = values.map((v) => ({
    value: v,
    label: props.labelFn(v),
    icon: props.iconFn(v),
  }));

  items.value = [...items.value, ...newItems.filter((i) => !items.value.some((e) => e.value === i.value))];
};

watch(() => props.modelValue, initializeItemsFromModel, { immediate: true });

watch(search, (value) => {
  if (timer.value) clearTimeout(timer.value);
  timer.value = setTimeout(() => void doSearch(value), 500);
});

const internalModelValue = computed({
  get: () => {
    return props.modelValue;
  },
  set: (value: ModelValue<TMultiple>) => {
    emit("update:modelValue", value);
  },
});
const attrs = useAttrs();
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
