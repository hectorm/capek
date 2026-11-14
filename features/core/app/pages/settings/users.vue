<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";
import { storeToRefs } from "pinia";

import { useOverlay } from "@nuxt/ui/composables/useOverlay";

import type { ResourceTableColumn } from "#layers/core/app/composables/resource-table";
import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { usePayloadData } from "#layers/core/app/composables/payload-data";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceTable } from "#layers/core/app/composables/resource-table";
import { useUserStore } from "#layers/core/app/stores/user";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { CorePermissions } from "#layers/core/shared/rbac";

import ConfirmDeleteModal from "#layers/core/app/components/ui/ConfirmDeleteModal.vue";
import ResourceTable from "#layers/core/app/components/ui/ResourceTable.vue";
import LazyUpsertModal from "#layers/core/app/components/users/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["user"]["search"], void>>;
type SearchOutput = RouterOutputs["user"]["search"];

type User = SearchOutput["users"][number];

const overlay = useOverlay();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();

const userStore = useUserStore();
const { user: me } = storeToRefs(userStore);

const [table, roles] = await Promise.all([
  useResourceTable({
    key: "user.search",
    query: { limit: 100, orderBy: "username", order: "asc" },
    search: async (input: SearchInput) => {
      const result = await $trpc.user.search.query(input);
      return { rows: result.users, nextCursor: result.nextCursor };
    },
  }),
  usePayloadData("role.list", () => $trpc.role.list.query()),
]);

const columns: ResourceTableColumn<SearchInput>[] = [
  {
    id: "username",
    sortable: true,
    filterable: true,
    class: { th: "w-0 min-w-50", td: "w-0 max-w-125 truncate" },
  },
  {
    id: "fullname",
    sortable: true,
    filterable: true,
    class: { th: "w-0 min-w-75", td: "w-0 max-w-150 truncate" },
  },
  {
    id: "email",
    sortable: true,
    filterable: true,
    class: { th: "w-0 min-w-75", td: "w-0 max-w-150 truncate" },
  },
  {
    id: "roles",
    filterable: true,
    items: (roles ?? []).map((r) => r.name),
    class: { th: "w-0 min-w-50", td: "w-0" },
  },
  {
    id: "groups",
    filterable: true,
    searchFn: async (search?: string) => {
      const searchResult = await $trpc.group.search.query({ search: search ?? "" });
      return searchResult.groups.map((g) => g.name);
    },
    class: { th: "w-0 min-w-50", td: "w-0" },
  },
];

const canUpdate = (): boolean => {
  return canAny([CorePermissions.UserReadAll, CorePermissions.UserUpdateAll]);
};

const canDelete = (user: User): boolean => {
  return can(CorePermissions.UserDeleteAll) && user.id !== me.value?.id;
};

const handleCreateModal = async (): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({});
  const modalResult = (await instance.result) as { user: User | null };
  if (modalResult.user) {
    table.addRow(modalResult.user);
  }
};

const handleUpdateModal = async (user: User): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({ id: user.id });
  const modalResult = (await instance.result) as { user: User | null };
  if (modalResult.user) {
    table.replaceRow(modalResult.user);
  }
};

const handleDeleteModal = async (user: User): Promise<void> => {
  const instance = overlay.create(ConfirmDeleteModal, { destroyOnClose: true }).open({
    i18nPrefix: "pages.settings.users",
    name: user.username,
    deletePermissions: [CorePermissions.UserDeleteAll],
    remove: () => $trpc.user.delete.mutate({ id: user.id }),
  });
  const { deleted } = (await instance.result) as { deleted: boolean };
  if (deleted) {
    table.removeRow(user);
  }
};

definePageMeta({
  title: "pages.settings.users.title",
  description: "pages.settings.users.description",
  permissions: [CorePermissions.UserReadAll],
});
</script>

<template>
  <ResourceTable
    :table="table"
    :columns="columns"
    :can-delete="canDelete"
    :can-update="canUpdate"
    i18n-prefix="pages.settings.users"
    :can-create="can(CorePermissions.UserCreate)"
    @create="() => void handleCreateModal()"
    @delete="(row) => void handleDeleteModal(row)"
    @update="(row) => void handleUpdateModal(row)"
  />
</template>
