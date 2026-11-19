<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";

import UBadge from "@nuxt/ui/components/Badge.vue";
import { useOverlay } from "@nuxt/ui/composables/useOverlay";

import { MAX_PAGE_SIZE } from "#layers/core/shared/pagination";
import type { ResourceTableColumn } from "#layers/core/app/composables/resource-table";
import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceTable } from "#layers/core/app/composables/resource-table";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { useDatasourceDelete } from "#layers/datasources/app/composables/datasource-delete";
import { DatasourcesPermissions } from "#layers/datasources/shared/rbac";
import { DatasourceTypes } from "#layers/datasources/shared/definitions";

import ResourceTable from "#layers/core/app/components/ui/ResourceTable.vue";
import LazyUpsertModal from "#layers/datasources/app/components/sources/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["datasources"]["source"]["search"], void>>;
type SearchOutput = RouterOutputs["datasources"]["source"]["search"];

type Datasource = SearchOutput["sources"][number];

const overlay = useOverlay();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();
const confirmDelete = useDatasourceDelete();

const table = await useResourceTable({
  key: "datasources.source.search",
  query: { limit: MAX_PAGE_SIZE, orderBy: "name", order: "asc" },
  search: async (input: SearchInput) => {
    const result = await $trpc.datasources.source.search.query(input);
    return { rows: result.sources, nextCursor: result.nextCursor };
  },
});

const columns: ResourceTableColumn<SearchInput>[] = [
  {
    id: "name",
    sortable: true,
    filterable: true,
    class: { th: "w-0 min-w-50", td: "w-0 max-w-125 truncate" },
  },
  {
    id: "description",
    filterable: true,
    class: { th: "w-0 min-w-75", td: "w-0 max-w-150 truncate" },
  },
  {
    id: "type",
    sortable: true,
    filterable: true,
    items: DatasourceTypes.map((type) => type.type),
    class: { th: "w-0 min-w-25", td: "w-0" },
  },
];

const getTypeLabel = (type: string): string => {
  return DatasourceTypes.find((candidate) => candidate.type === type)?.label ?? type;
};

const canUpdate = (): boolean => {
  return canAny([
    DatasourcesPermissions.SourceReadAll,
    DatasourcesPermissions.SourceReadOwn,
    DatasourcesPermissions.SourceUpdateAll,
    DatasourcesPermissions.SourceUpdateOwn,
  ]);
};

const canDelete = (): boolean => {
  return canAny([DatasourcesPermissions.SourceDeleteAll, DatasourcesPermissions.SourceDeleteOwn]);
};

const handleUpsertModal = async (id?: string): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({ id });
  const modalResult = (await instance.result) as { datasource: Datasource | null };
  if (modalResult.datasource) {
    await table.refresh();
  }
};

const handleDeleteModal = async (datasource: Datasource): Promise<void> => {
  if (await confirmDelete(datasource)) {
    await table.refresh();
  }
};

definePageMeta({
  title: "datasources.pages.studio.datasources.title",
  description: "datasources.pages.studio.datasources.description",
  permissions: [
    DatasourcesPermissions.SourceCreate,
    DatasourcesPermissions.SourceUpdateAll,
    DatasourcesPermissions.SourceUpdateOwn,
  ],
});
</script>

<template>
  <ResourceTable
    :table="table"
    :columns="columns"
    :can-delete="canDelete"
    :can-update="canUpdate"
    i18n-prefix="datasources.pages.studio.datasources"
    :can-create="can(DatasourcesPermissions.SourceCreate)"
    @create="() => void handleUpsertModal()"
    @delete="(row) => void handleDeleteModal(row)"
    @update="(row) => void handleUpsertModal(row.id)"
  >
    <template #type-cell="{ row }">
      <UBadge color="neutral" variant="outline" :label="getTypeLabel(row.type)" />
    </template>
  </ResourceTable>
</template>
