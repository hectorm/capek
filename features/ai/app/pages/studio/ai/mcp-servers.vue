<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";

import { useOverlay } from "@nuxt/ui/composables/useOverlay";

import { MAX_PAGE_SIZE } from "#layers/core/shared/pagination";
import type { ResourceTableColumn } from "#layers/core/app/composables/resource-table";
import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceTable } from "#layers/core/app/composables/resource-table";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { AiPermissions } from "#layers/ai/shared/rbac";

import ConfirmDeleteModal from "#layers/core/app/components/ui/ConfirmDeleteModal.vue";
import ResourceTable from "#layers/core/app/components/ui/ResourceTable.vue";
import LazyUpsertModal from "#layers/ai/app/components/mcpServers/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["ai"]["mcpServer"]["search"], void>>;
type SearchOutput = RouterOutputs["ai"]["mcpServer"]["search"];

type McpServer = SearchOutput["mcpServers"][number];

const overlay = useOverlay();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();

const table = await useResourceTable({
  key: "ai.mcpServer.search",
  query: { limit: MAX_PAGE_SIZE, orderBy: "name", order: "asc" },
  search: async (input: SearchInput) => {
    const result = await $trpc.ai.mcpServer.search.query(input);
    return { rows: result.mcpServers, nextCursor: result.nextCursor };
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
    id: "url",
    sortable: true,
    filterable: true,
    class: { th: "w-0 min-w-75", td: "w-0 max-w-150 truncate" },
  },
];

const deletePermissions = [AiPermissions.McpServerDeleteAll, AiPermissions.McpServerDeleteOwn];

const canUpdate = (): boolean => {
  return canAny([
    AiPermissions.McpServerReadAll,
    AiPermissions.McpServerReadOwn,
    AiPermissions.McpServerUpdateAll,
    AiPermissions.McpServerUpdateOwn,
  ]);
};

const canDelete = (): boolean => {
  return canAny(deletePermissions);
};

const handleCreateModal = async (): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({});
  const modalResult = (await instance.result) as { mcpServer: McpServer | null };
  if (modalResult.mcpServer) {
    table.addRow(modalResult.mcpServer);
  }
};

const handleUpdateModal = async (mcpServer: McpServer): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({ id: mcpServer.id });
  const modalResult = (await instance.result) as { mcpServer: McpServer | null };
  if (modalResult.mcpServer) {
    table.replaceRow(modalResult.mcpServer);
  }
};

const handleDeleteModal = async (mcpServer: McpServer): Promise<void> => {
  const instance = overlay.create(ConfirmDeleteModal, { destroyOnClose: true }).open({
    i18nPrefix: "ai.pages.studio.mcpServers",
    name: mcpServer.name,
    deletePermissions,
    loadAccess: () => $trpc.ai.mcpServer.listAccess.query({ mcpServerId: mcpServer.id }),
    remove: () => $trpc.ai.mcpServer.delete.mutate({ id: mcpServer.id }),
  });
  const { deleted } = (await instance.result) as { deleted: boolean };
  if (deleted) {
    table.removeRow(mcpServer);
  }
};

definePageMeta({
  title: "ai.pages.studio.mcpServers.title",
  description: "ai.pages.studio.mcpServers.description",
  permissions: [AiPermissions.McpServerCreate, AiPermissions.McpServerUpdateAll, AiPermissions.McpServerUpdateOwn],
});
</script>

<template>
  <ResourceTable
    :table="table"
    :columns="columns"
    :can-delete="canDelete"
    :can-update="canUpdate"
    i18n-prefix="ai.pages.studio.mcpServers"
    :can-create="can(AiPermissions.McpServerCreate)"
    @create="() => void handleCreateModal()"
    @delete="(row) => void handleDeleteModal(row)"
    @update="(row) => void handleUpdateModal(row)"
  />
</template>
