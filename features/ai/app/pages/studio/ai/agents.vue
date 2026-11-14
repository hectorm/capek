<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";

import UBadge from "@nuxt/ui/components/Badge.vue";
import { useOverlay } from "@nuxt/ui/composables/useOverlay";

import type { ResourceTableColumn } from "#layers/core/app/composables/resource-table";
import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceTable } from "#layers/core/app/composables/resource-table";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { useAgentStore } from "#layers/ai/app/stores/agent";
import { AiPermissions } from "#layers/ai/shared/rbac";

import ConfirmDeleteModal from "#layers/core/app/components/ui/ConfirmDeleteModal.vue";
import ResourceTable from "#layers/core/app/components/ui/ResourceTable.vue";
import LazyUpsertModal from "#layers/ai/app/components/agents/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["ai"]["agent"]["search"], void>>;
type SearchOutput = RouterOutputs["ai"]["agent"]["search"];

type Agent = SearchOutput["agents"][number];

const overlay = useOverlay();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();
const agentStore = useAgentStore();

const table = await useResourceTable({
  key: "ai.agent.search",
  query: { limit: 100, orderBy: "name", order: "asc" },
  search: async (input: SearchInput) => {
    const result = await $trpc.ai.agent.search.query(input);
    return { rows: result.agents, nextCursor: result.nextCursor };
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
    items: ["triage", "specialist"],
    class: { th: "w-0 min-w-25", td: "w-0" },
  },
  {
    id: "model",
    sortable: true,
    filterable: true,
    class: { th: "w-0 min-w-50", td: "w-0 max-w-100 truncate" },
  },
  {
    id: "priority",
    sortable: true,
    class: { th: "w-0 min-w-25", td: "w-0" },
  },
];

const canUpdate = (): boolean => {
  return canAny([
    AiPermissions.AgentReadAll,
    AiPermissions.AgentReadOwn,
    AiPermissions.AgentUpdateAll,
    AiPermissions.AgentUpdateOwn,
  ]);
};

const deletePermissions = [AiPermissions.AgentDeleteAll, AiPermissions.AgentDeleteOwn];

const canDelete = (): boolean => {
  return canAny(deletePermissions);
};

const refreshChatAgents = (): void => {
  if (canAny([AiPermissions.AgentUseAll, AiPermissions.AgentUseOwn])) {
    agentStore.fetch().catch((error: unknown) => {
      console.warn("Failed to refresh the agents of the chat pages", error);
    });
  }
};

const handleCreateModal = async (): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({});
  const modalResult = (await instance.result) as { agent: Agent | null };
  if (modalResult.agent) {
    table.addRow(modalResult.agent);
    refreshChatAgents();
  }
};

const handleUpdateModal = async (agent: Agent): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({ id: agent.id });
  const modalResult = (await instance.result) as { agent: Agent | null };
  if (modalResult.agent) {
    table.replaceRow(modalResult.agent);
    refreshChatAgents();
  }
};

const handleDeleteModal = async (agent: Agent): Promise<void> => {
  const instance = overlay.create(ConfirmDeleteModal, { destroyOnClose: true }).open({
    i18nPrefix: "ai.pages.studio.agents",
    name: agent.name,
    deletePermissions,
    loadAccess: () => $trpc.ai.agent.listAccess.query({ agentId: agent.id }),
    remove: () => $trpc.ai.agent.delete.mutate({ id: agent.id }),
  });
  const { deleted } = (await instance.result) as { deleted: boolean };
  if (deleted) {
    table.removeRow(agent);
    refreshChatAgents();
  }
};

definePageMeta({
  title: "ai.pages.studio.agents.title",
  description: "ai.pages.studio.agents.description",
  permissions: [AiPermissions.AgentCreate, AiPermissions.AgentUpdateAll, AiPermissions.AgentUpdateOwn],
});
</script>

<template>
  <ResourceTable
    :table="table"
    :columns="columns"
    :can-delete="canDelete"
    :can-update="canUpdate"
    i18n-prefix="ai.pages.studio.agents"
    :can-create="can(AiPermissions.AgentCreate)"
    @create="() => void handleCreateModal()"
    @delete="(row) => void handleDeleteModal(row)"
    @update="(row) => void handleUpdateModal(row)"
  >
    <template #type-cell="{ row }">
      <UBadge :label="row.type" variant="outline" :color="row.type === 'triage' ? 'primary' : 'neutral'" />
    </template>
  </ResourceTable>
</template>
