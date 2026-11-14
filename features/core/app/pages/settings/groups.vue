<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";

import { useOverlay } from "@nuxt/ui/composables/useOverlay";

import type { ResourceTableColumn } from "#layers/core/app/composables/resource-table";
import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { usePayloadData } from "#layers/core/app/composables/payload-data";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceTable } from "#layers/core/app/composables/resource-table";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { CorePermissions } from "#layers/core/shared/rbac";

import ConfirmDeleteModal from "#layers/core/app/components/ui/ConfirmDeleteModal.vue";
import ResourceTable from "#layers/core/app/components/ui/ResourceTable.vue";
import LazyUpsertModal from "#layers/core/app/components/groups/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["group"]["search"], void>>;
type SearchOutput = RouterOutputs["group"]["search"];

type Group = SearchOutput["groups"][number];

const overlay = useOverlay();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();

const [table, roles] = await Promise.all([
  useResourceTable({
    key: "group.search",
    query: { limit: 100, orderBy: "name", order: "asc" },
    search: async (input: SearchInput) => {
      const result = await $trpc.group.search.query(input);
      return { rows: result.groups, nextCursor: result.nextCursor };
    },
  }),
  usePayloadData("role.list", () => $trpc.role.list.query()),
]);

const columns: ResourceTableColumn<SearchInput>[] = [
  {
    id: "name",
    sortable: true,
    filterable: true,
    class: { th: "w-0 min-w-50", td: "w-0 max-w-125 truncate" },
  },
  {
    id: "description",
    class: { th: "w-0 min-w-75", td: "w-0 max-w-150 truncate" },
  },
  {
    id: "roles",
    filterable: true,
    items: (roles ?? []).map((r) => r.name),
    class: { th: "w-0 min-w-50", td: "w-0" },
  },
];

const canUpdate = (): boolean => {
  return canAny([CorePermissions.GroupReadAll, CorePermissions.GroupUpdateAll]);
};

const canDelete = (): boolean => {
  return can(CorePermissions.GroupDeleteAll);
};

const handleCreateModal = async (): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({});
  const modalResult = (await instance.result) as { group: Group | null };
  if (modalResult.group) {
    table.addRow(modalResult.group);
  }
};

const handleUpdateModal = async (group: Group): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({ id: group.id });
  const modalResult = (await instance.result) as { group: Group | null };
  if (modalResult.group) {
    table.replaceRow(modalResult.group);
  }
};

const handleDeleteModal = async (group: Group): Promise<void> => {
  const instance = overlay.create(ConfirmDeleteModal, { destroyOnClose: true }).open({
    i18nPrefix: "pages.settings.groups",
    name: group.name,
    deletePermissions: [CorePermissions.GroupDeleteAll],
    remove: () => $trpc.group.delete.mutate({ id: group.id }),
  });
  const { deleted } = (await instance.result) as { deleted: boolean };
  if (deleted) {
    table.removeRow(group);
  }
};

definePageMeta({
  title: "pages.settings.groups.title",
  description: "pages.settings.groups.description",
  permissions: [CorePermissions.GroupReadAll],
});
</script>

<template>
  <ResourceTable
    :table="table"
    :columns="columns"
    :can-delete="canDelete"
    :can-update="canUpdate"
    i18n-prefix="pages.settings.groups"
    :can-create="can(CorePermissions.GroupCreate)"
    @create="() => void handleCreateModal()"
    @delete="(row) => void handleDeleteModal(row)"
    @update="(row) => void handleUpdateModal(row)"
  />
</template>
