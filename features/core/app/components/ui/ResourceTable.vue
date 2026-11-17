<script setup lang="ts" generic="Q extends ResourceTableQuery, R extends { id: string }">
import type { ComponentPublicInstance } from "vue";
import { useInfiniteScroll } from "@vueuse/core";
import { computed, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";

import type { DropdownMenuItem, TableColumn } from "@nuxt/ui";
import UBadge from "@nuxt/ui/components/Badge.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import UDropdownMenu from "@nuxt/ui/components/DropdownMenu.vue";
import UTable from "@nuxt/ui/components/Table.vue";

import type {
  ResourceTableColumn,
  ResourceTableQuery,
  ResourceTableState,
} from "#layers/core/app/composables/resource-table";

import ResourceTableHeader from "#layers/core/app/components/ui/ResourceTableHeader.vue";

const props = defineProps<{
  table: ResourceTableState<Q, R>;
  columns: ResourceTableColumn[];
  // Prefix of the resource messages, used for the "table.<columnId>" labels of the columns
  i18nPrefix: string;
  canCreate?: boolean;
  canUpdate: (row: R) => boolean;
  canDelete: (row: R) => boolean;
}>();

const emit = defineEmits<{
  create: [];
  update: [row: R];
  delete: [row: R];
}>();

defineSlots<
  {
    // Content of the table without rows, "filtered" when a filter of the columns removed them
    empty?: (props: { filtered: boolean }) => unknown;
  } & Record<`${string}-cell`, (props: { row: R }) => unknown>
>();

const i18n = useI18n();

const ACTIONS_COLUMN = "actions";
const columnPinning = { left: [], right: [ACTIONS_COLUMN] };
const sortingOptions = { manualSorting: true };
const virtualize = { estimateSize: 37 };

const tableComponent = useTemplateRef<ComponentPublicInstance>("tableComponent");

const tableColumns = computed<TableColumn<R>[]>(() => [
  ...props.columns.map((column) => ({
    id: column.id,
    accessorKey: column.id,
    enableSorting: column.sortable === true,
    meta: { class: column.class },
  })),
  {
    id: ACTIONS_COLUMN,
    meta: { class: { th: "w-0 min-w-15 bg-default", td: "w-0 px-0 py-1 text-center bg-default bg-clip-content" } },
  },
]);

// Lets the table mark the sorted column, as the rows come sorted from the server
const sorting = computed(() => {
  const { orderBy, order } = props.table.query.value;
  return orderBy ? [{ id: orderBy, desc: order === "desc" }] : [];
});

const filtered = computed(() => Boolean(props.table.query.value.search?.length));

// Remounts the table when the locale changes, since it does not render its headers and cells again
const tableKey = computed(() => i18n.locale.value);

const rowActions = (row: R): DropdownMenuItem[] => {
  const actions: DropdownMenuItem[] = [];
  if (props.canUpdate(row)) {
    actions.push({
      label: i18n.t("components.resourceTable.update"),
      icon: "i-lucide-edit",
      color: "neutral",
      onSelect: () => {
        emit("update", row);
      },
    });
  }
  if (props.canDelete(row)) {
    actions.push({
      label: i18n.t("components.resourceTable.delete"),
      icon: "i-lucide-trash-2",
      color: "error",
      onSelect: () => {
        emit("delete", row);
      },
    });
  }
  return actions;
};

const scrollToTop = (): void => {
  if (tableComponent.value) {
    (tableComponent.value.$el as HTMLElement).scrollTop = 0;
  }
};

const onOrder = (columnId: string, order: "asc" | "desc"): void => {
  scrollToTop();
  void props.table.setOrder(columnId, order);
};

const onFilter = (columnId: string, value: string | string[]): void => {
  scrollToTop();
  void props.table.setFilter(columnId, value);
};

useInfiniteScroll(
  () => tableComponent.value?.$el as HTMLElement | undefined,
  () => props.table.loadMore(),
  {
    distance: 200,
    canLoadMore: () => props.table.canLoadMore.value,
  },
);
</script>

<template>
  <UTable
    :key="tableKey"
    ref="tableComponent"
    sticky
    :sorting="sorting"
    :columns="tableColumns"
    :data="table.rows.value"
    :virtualize="virtualize"
    :loading="table.loading.value"
    :column-pinning="columnPinning"
    :sorting-options="sortingOptions"
    :ui="{ base: 'overflow-visible', th: 'py-1', td: 'py-2' }"
  >
    <template v-for="column in columns" :key="column.id" #[`${column.id}-header`]>
      <ResourceTableHeader
        :column="column"
        :query="table.query.value"
        :label="$t(`${i18nPrefix}.table.${column.id}`)"
        @order="onOrder(column.id, $event)"
        @filter="onFilter(column.id, $event)"
      />
    </template>
    <template #[`${ACTIONS_COLUMN}-header`]>
      <UButton
        v-if="canCreate"
        color="neutral"
        variant="ghost"
        icon="i-lucide-plus"
        :aria-label="$t('components.resourceTable.create')"
        @click="emit('create')"
      />
    </template>
    <template v-for="column in columns" :key="column.id" #[`${column.id}-cell`]="{ row, cell }">
      <slot :row="row.original" :name="`${column.id}-cell`">
        <template v-if="Array.isArray(cell.getValue())">
          <UBadge
            v-for="value in cell.getValue() as unknown[]"
            :key="String(value)"
            class="mr-1.5"
            color="neutral"
            variant="outline"
            :label="String(value)"
          />&nbsp;
        </template>
        <template v-else>
          {{ String(cell.getValue() ?? "") || "&nbsp;" }}
        </template>
      </slot>
    </template>
    <template #[`${ACTIONS_COLUMN}-cell`]="{ row }">
      <UDropdownMenu v-if="rowActions(row.original).length > 0" :items="rowActions(row.original)">
        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          icon="i-lucide-ellipsis-vertical"
          :aria-label="$t('components.resourceTable.actions')"
        />
      </UDropdownMenu>
    </template>
    <template v-if="table.loadMoreFailed.value" #body-bottom>
      <tr>
        <td :colspan="tableColumns.length" class="px-4 py-2 text-center text-sm text-muted">
          {{ $t("components.resourceTable.loadError") }}
          <UButton
            size="sm"
            class="ml-2"
            color="neutral"
            variant="outline"
            icon="i-lucide-rotate-cw"
            :label="$t('components.resourceTable.retry')"
            @click="() => void table.loadMore()"
          />
        </td>
      </tr>
    </template>
    <template #empty>
      <template v-if="!table.loading.value">
        <slot name="empty" :filtered="filtered">
          {{ filtered ? $t("components.resourceTable.noMatches") : $t("components.resourceTable.empty") }}
        </slot>
      </template>
      <template v-else>&nbsp;</template>
    </template>
  </UTable>
</template>
