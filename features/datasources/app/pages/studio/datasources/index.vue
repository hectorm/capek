<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import { useInfiniteScroll } from "@vueuse/core";
import { useNuxtApp } from "nuxt/app";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { DropdownMenuItem, TableColumn } from "@nuxt/ui";
import UBadge from "@nuxt/ui/components/Badge.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import UDropdownMenu from "@nuxt/ui/components/DropdownMenu.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UPopover from "@nuxt/ui/components/Popover.vue";
import USelectMenu from "@nuxt/ui/components/SelectMenu.vue";
import UTable from "@nuxt/ui/components/Table.vue";
import { useOverlay } from "@nuxt/ui/composables/useOverlay";
import { useToast } from "@nuxt/ui/composables/useToast";

import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { DatasourcesPermissions } from "#layers/datasources/shared/rbac";
import { DatasourceTypes } from "#layers/datasources/shared/definitions";

import LazyUpsertModal from "#layers/datasources/app/components/sources/UpsertModal.vue";
import ConfirmDeleteModal from "#layers/core/app/components/ui/ConfirmDeleteModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["datasources"]["source"]["search"], void>>;
type SearchOutput = RouterOutputs["datasources"]["source"]["search"];

type Datasource = SearchOutput["sources"][number];

const i18n = useI18n();
const overlay = useOverlay();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();

const upsertModal = overlay.create(LazyUpsertModal);
const deleteModal = overlay.create(ConfirmDeleteModal);

const getTypeLabel = (type: string): string => {
  return DatasourceTypes.find((candidate) => candidate.type === type)?.label ?? type;
};

const table = useTemplateRef<ComponentPublicInstance>("table");
const query = ref<SearchInput>({ limit: 100, orderBy: "name", order: "asc" });
const result = shallowRef<SearchOutput>(await $trpc.datasources.source.search.query(query.value));
const datasources = shallowRef<Datasource[]>(result.value.sources);
const loading = ref<boolean>(false);

const columns = computed(() => [
  {
    id: "name",
    accessorKey: "name",
    meta: {
      sortable: true,
      filterable: true,
      class: { th: "w-0 min-w-50", td: "w-0 max-w-125 truncate" },
    },
  },
  {
    id: "description",
    accessorKey: "description",
    meta: {
      filterable: true,
      class: { th: "w-0 min-w-75", td: "w-0 max-w-150 truncate" },
    },
  },
  {
    id: "type",
    accessorKey: "type",
    meta: {
      sortable: true,
      filterable: true,
      select: true,
      multiple: true,
      items: DatasourceTypes.map((type) => type.type),
      class: { th: "w-0 min-w-25", td: "w-0" },
    },
  },
  {
    id: "action",
    meta: {
      class: { th: "w-0 min-w-15", td: "w-0 px-0 text-center bg-clip-content" },
    },
  },
]);

const columnPinning = {
  left: [],
  right: ["action"],
};

const doSearch = async (reset = false): Promise<void> => {
  try {
    loading.value = true;
    if (reset) {
      if (table.value) {
        const el = table.value.$el as HTMLElement;
        el.scrollTop = 0;
      }
      result.value = await $trpc.datasources.source.search.query({ ...query.value, cursor: undefined });
      datasources.value = result.value.sources;
    } else {
      result.value = await $trpc.datasources.source.search.query({ ...query.value, cursor: result.value.nextCursor });
      datasources.value = datasources.value.concat(result.value.sources);
    }
  } finally {
    loading.value = false;
  }
};

const hasOrder = (column: TableColumn<Datasource>) => {
  return query.value.orderBy === column.id && !!query.value.order;
};

const setOrder = (column: TableColumn<Datasource>, order: "asc" | "desc" | undefined) => {
  query.value.orderBy = column.id as SearchInput["orderBy"];
  query.value.order = order;
  void doSearch(true);
};

const hasFilter = (column: TableColumn<Datasource>) => {
  return query.value.searchBy === column.id && query.value.search && query.value.search.length > 0;
};

const setFilter = (column: TableColumn<Datasource>, value: string | string[]) => {
  query.value.searchBy = column.id as SearchInput["searchBy"];
  query.value.search = value;
  void doSearch(true);
};

const getDropdownActions = (datasource: Datasource): DropdownMenuItem[] => {
  const actions: DropdownMenuItem[] = [];

  if (
    canAny([
      DatasourcesPermissions.SourceReadAll,
      DatasourcesPermissions.SourceReadOwn,
      DatasourcesPermissions.SourceUpdateAll,
      DatasourcesPermissions.SourceUpdateOwn,
    ])
  ) {
    actions.push({
      label: i18n.t("datasources.pages.studio.datasources.table.actions.update.label"),
      icon: "i-lucide-edit",
      color: "neutral",
      onSelect: () => void handleUpdateModal(datasource),
    });
  }

  if (canAny([DatasourcesPermissions.SourceDeleteAll, DatasourcesPermissions.SourceDeleteOwn])) {
    actions.push({
      label: i18n.t("datasources.pages.studio.datasources.table.actions.delete.label"),
      icon: "i-lucide-trash-2",
      color: "error",
      onSelect: () => void handleDeleteModal(datasource),
    });
  }

  return actions;
};

const handleCreateModal = async (): Promise<void> => {
  const instance = upsertModal.open({});
  const modalResult = (await instance.result) as { datasource: Datasource | null; error: Error | null };
  if (modalResult.datasource) {
    datasources.value = datasources.value.toSpliced(0, 0, modalResult.datasource);
    toast.add({
      color: "success",
      title: i18n.t("datasources.pages.studio.datasources.table.actions.create.success.title"),
      description: i18n.t("datasources.pages.studio.datasources.table.actions.create.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("datasources.pages.studio.datasources.table.actions.create.error.title"),
      description: i18n.t("datasources.pages.studio.datasources.table.actions.create.error.description"),
    });
  }
};

const handleUpdateModal = async (datasource: Datasource): Promise<void> => {
  const instance = upsertModal.open({ id: datasource.id });
  const modalResult = (await instance.result) as { datasource: Datasource | null; error: Error | null };
  if (modalResult.datasource) {
    const updatedDatasource = modalResult.datasource;
    const i = datasources.value.findIndex((d) => d.id === updatedDatasource.id);
    if (i >= 0) datasources.value = datasources.value.toSpliced(i, 1, updatedDatasource);
    toast.add({
      color: "success",
      title: i18n.t("datasources.pages.studio.datasources.table.actions.update.success.title"),
      description: i18n.t("datasources.pages.studio.datasources.table.actions.update.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("datasources.pages.studio.datasources.table.actions.update.error.title"),
      description: i18n.t("datasources.pages.studio.datasources.table.actions.update.error.description"),
    });
  }
};

const handleDeleteModal = async (datasource: Datasource): Promise<void> => {
  const instance = deleteModal.open({
    id: datasource.id,
    i18nPrefix: "datasources.pages.studio.datasources",
    deletePermissions: [DatasourcesPermissions.SourceDeleteAll, DatasourcesPermissions.SourceDeleteOwn],
    load: async (id: string) => {
      const [current, access] = await Promise.all([
        $trpc.datasources.source.read.query({ id }),
        $trpc.datasources.source.listAccess.query({ sourceId: id }),
      ]);
      return { name: current.name, editorPrincipalIds: access.filter((a) => a.role === "editor").map((a) => a.id) };
    },
    remove: async (id: string) => {
      await $trpc.datasources.source.delete.mutate({ id });
    },
  });
  const modalResult = (await instance.result) as { deleted: boolean; error: Error | null };
  if (modalResult.deleted) {
    const i = datasources.value.findIndex((d) => d.id === datasource.id);
    if (i >= 0) datasources.value = datasources.value.toSpliced(i, 1);
    toast.add({
      color: "success",
      title: i18n.t("datasources.pages.studio.datasources.table.actions.delete.success.title"),
      description: i18n.t("datasources.pages.studio.datasources.table.actions.delete.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("datasources.pages.studio.datasources.table.actions.delete.error.title"),
      description: i18n.t("datasources.pages.studio.datasources.table.actions.delete.error.description"),
    });
  }
};

useInfiniteScroll(
  () => table.value?.$el as HTMLElement | undefined,
  () => void doSearch(),
  {
    distance: 200,
    canLoadMore: () => result.value.nextCursor != null && !loading.value,
  },
);

const tableKey = ref<number>(0);
watch(i18n.locale, () => {
  tableKey.value = Date.now();
});

definePageMeta({
  title: "datasources.pages.studio.datasources.title",
  description: "datasources.pages.studio.datasources.description",
  permissions: [DatasourcesPermissions.SourceCreate],
});
</script>

<template>
  <UTable
    ref="table"
    :key="tableKey"
    sticky
    :columns="columns"
    :loading="loading"
    :data="datasources"
    :column-pinning="columnPinning"
  >
    <template v-for="{ id, meta } in columns" :key="id" #[`${id}-header`]="{ column }">
      <template v-if="id === 'action'">
        <UButton
          v-if="can(DatasourcesPermissions.SourceCreate)"
          color="neutral"
          variant="ghost"
          icon="i-lucide-plus"
          :aria-label="$t('datasources.pages.studio.datasources.table.actions.create.label')"
          @click="() => void handleCreateModal()"
        />
      </template>
      <UFieldGroup
        v-else
        class="-mx-2.5 flex w-full flex-row"
        :aria-label="$t(`datasources.pages.studio.datasources.table.${id}`)"
      >
        <UButton
          v-if="meta.sortable"
          class="flex-1"
          color="neutral"
          variant="ghost"
          :label="$t(`datasources.pages.studio.datasources.table.${id}`)"
          :aria-label="$t('datasources.pages.studio.datasources.table.sort')"
          :icon="
            hasOrder(column)
              ? query.order === 'asc'
                ? 'i-lucide-arrow-up-narrow-wide'
                : 'i-lucide-arrow-down-wide-narrow'
              : 'i-lucide-arrow-up-down'
          "
          @click="setOrder(column, query.order === 'asc' ? 'desc' : 'asc')"
        />
        <UButton
          v-else
          color="neutral"
          variant="ghost"
          class="flex-1 cursor-default"
          :label="$t(`datasources.pages.studio.datasources.table.${id}`)"
        />
        <UPopover v-if="meta.filterable">
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="$t('datasources.pages.studio.datasources.table.filter')"
            :icon="hasFilter(column) ? 'i-lucide-list-filter-plus' : 'i-lucide-list-filter'"
          />
          <template #content>
            <template v-if="meta.select">
              <USelectMenu
                class="w-64"
                color="neutral"
                variant="ghost"
                :search-input="false"
                icon="i-lucide-search"
                :items="meta.items ?? []"
                :multiple="meta.multiple"
                :aria-label="$t('datasources.pages.studio.datasources.table.search')"
                :model-value="hasFilter(column) && Array.isArray(query.search) ? query.search : []"
                @update:model-value="setFilter(column, $event)"
              />
            </template>
            <template v-else>
              <UInput
                class="w-64"
                color="neutral"
                variant="ghost"
                icon="i-lucide-search"
                :aria-label="$t('datasources.pages.studio.datasources.table.search')"
                :model-value="hasFilter(column) && !Array.isArray(query.search) ? query.search : ''"
                @keydown.enter="setFilter(column, $event.target.value)"
              />
            </template>
          </template>
        </UPopover>
      </UFieldGroup>
    </template>
    <template v-for="{ id } in columns" :key="id" #[`${id}-cell`]="{ row, cell }">
      <template v-if="id === 'action'">
        <UDropdownMenu
          v-if="getDropdownActions((row as { original: Datasource }).original).length > 0"
          :items="getDropdownActions((row as { original: Datasource }).original)"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ellipsis-vertical"
            :aria-label="$t('datasources.pages.studio.datasources.table.actions.title')"
          />
        </UDropdownMenu>
      </template>
      <template v-else-if="id === 'type'">
        <UBadge color="neutral" variant="outline" :label="getTypeLabel(String(cell.getValue()))" />
      </template>
      <template v-else>
        {{ cell.getValue() || "&nbsp;" }}
      </template>
    </template>
    <template #empty>&nbsp;</template>
  </UTable>
</template>
