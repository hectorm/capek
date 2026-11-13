<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { useFullscreen } from "@vueuse/core";
import { useNuxtApp } from "nuxt/app";
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";

import UButton from "@nuxt/ui/components/Button.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UPopover from "@nuxt/ui/components/Popover.vue";
import UTable from "@nuxt/ui/components/Table.vue";
import { useToast } from "@nuxt/ui/composables/useToast";

import type { ChatTablePart } from "#layers/ai/shared/chat";
import { cellText, compareCells, toCsv } from "#layers/ai/app/utils/table";

const props = defineProps<{
  table: ChatTablePart;
}>();

const rowHeight = 37;

const i18n = useI18n();
const toast = useToast();
const { $trpc } = useNuxtApp();

const container = useTemplateRef<HTMLDivElement>("container");

const { isSupported: canFullscreen, isFullscreen, toggle: toggleFullscreen } = useFullscreen(container);

const rows = shallowRef<unknown[][]>(props.table.rows);
const loading = ref<boolean>(false);
const sorting = ref<{ id: string; desc: boolean }[]>([]);
const filters = ref<string[]>(props.table.columns.map(() => ""));

let csvUrl: string | undefined;

const complete = computed(() => rows.value.length >= props.table.rowCount);

const filtered = computed(() => {
  const texts = filters.value.map((text) => text.toLowerCase());
  return rows.value.filter((row) => {
    return texts.every((text, index) => cellText(row[index]).toLowerCase().includes(text));
  });
});

const columns = computed<TableColumn<unknown[]>[]>(() => {
  return props.table.columns.map((_name, index) => ({
    id: String(index),
    accessorFn: (row) => row[index] ?? undefined,
    sortingFn: (a, b, id) => compareCells(a.getValue(id), b.getValue(id)),
    sortUndefined: "last",
  }));
});

const load = async (): Promise<boolean> => {
  if (complete.value) {
    return true;
  }

  loading.value = true;
  try {
    const data = await $trpc.ai.chatTable.read.query({ id: props.table.id });
    rows.value = (JSON.parse(data) as Pick<ChatTablePart, "rows">).rows;
    return true;
  } catch (error) {
    console.error("Failed to load table", error);
    toast.add({
      color: "error",
      title: i18n.t("ai.components.chat.tableView.error.title"),
      description: i18n.t("ai.components.chat.tableView.error.description"),
    });
    return false;
  } finally {
    loading.value = false;
  }
};

const releaseCsv = () => {
  if (csvUrl) {
    URL.revokeObjectURL(csvUrl);
  }
};

const sort = async (index: number) => {
  if (await load()) {
    const id = String(index);
    const [current] = sorting.value;
    sorting.value = [{ id, desc: current?.id === id && !current.desc }];
  }
};

const sortIcon = (index: number): string => {
  const [current] = sorting.value;
  if (current?.id !== String(index)) {
    return "i-lucide-arrow-up-down";
  }
  return current.desc ? "i-lucide-arrow-down-wide-narrow" : "i-lucide-arrow-up-narrow-wide";
};

const exportCsv = async () => {
  if (!(await load())) {
    return;
  }

  releaseCsv();
  csvUrl = URL.createObjectURL(new Blob([toCsv(props.table.columns, rows.value)], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = csvUrl;
  link.download = `${props.table.name}.csv`;
  link.click();
};

onBeforeUnmount(releaseCsv);
</script>

<template>
  <div ref="container" class="flex flex-col gap-1 [&:fullscreen]:bg-default [&:fullscreen]:p-4">
    <UTable
      v-model:sorting="sorting"
      sticky="header"
      :data="filtered"
      :columns="columns"
      :loading="loading"
      :ui="{ th: 'py-1', td: 'py-2' }"
      :virtualize="{ estimateSize: rowHeight }"
      :class="isFullscreen ? 'min-h-0 flex-1' : 'max-h-96'"
    >
      <template v-for="(name, index) in table.columns" :key="index" #[`${index}-header`]>
        <UFieldGroup :aria-label="name" class="-mx-2.5 flex w-full flex-row">
          <UButton
            :label="name"
            class="flex-1"
            color="neutral"
            variant="ghost"
            :trailing-icon="sortIcon(index)"
            :aria-label="$t('ai.components.chat.tableView.sort', { column: name })"
            @click="() => void sort(index)"
          />
          <UPopover :ui="{ content: 'z-10' }" :portal="container ?? undefined">
            <UButton
              color="neutral"
              variant="ghost"
              :aria-label="$t('ai.components.chat.tableView.filter', { column: name })"
              :icon="filters[index] ? 'i-lucide-list-filter-plus' : 'i-lucide-list-filter'"
              @click="() => void load()"
            />
            <template #content>
              <UInput
                v-model="filters[index]"
                class="w-64"
                color="neutral"
                variant="ghost"
                icon="i-lucide-search"
                :aria-label="$t('ai.components.chat.tableView.search')"
              />
            </template>
          </UPopover>
        </UFieldGroup>
      </template>
      <template v-for="(_name, index) in table.columns" :key="index" #[`${index}-cell`]="{ cell }">
        {{ cellText(cell.getValue()) }}
      </template>
    </UTable>
    <div class="flex items-center gap-1 text-sm text-muted">
      <span v-if="!complete">
        {{ $t("ai.components.chat.tableView.preview", { shown: rows.length, total: table.rowCount }) }}
      </span>
      <span v-else-if="filtered.length < rows.length">
        {{ $t("ai.components.chat.tableView.filtered", { shown: filtered.length, total: table.rowCount }) }}
      </span>
      <span v-else>
        {{ $t("ai.components.chat.tableView.rows", { total: table.rowCount }) }}
      </span>
      <UButton v-if="!complete" size="sm" variant="link" :loading="loading" @click="() => void load()">
        {{ $t("ai.components.chat.tableView.showAll") }}
      </UButton>
      <UButton
        square
        size="sm"
        class="ml-auto"
        color="neutral"
        variant="ghost"
        icon="i-lucide-download"
        :aria-label="$t('ai.components.chat.tableView.export.label')"
        @click="() => void exportCsv()"
      />
      <UButton
        v-if="canFullscreen"
        square
        size="sm"
        color="neutral"
        variant="ghost"
        :icon="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
        :aria-label="$t(`ai.components.chat.tableView.fullscreen.${isFullscreen ? 'exit' : 'enter'}`)"
        @click="toggleFullscreen"
      />
    </div>
  </div>
</template>
