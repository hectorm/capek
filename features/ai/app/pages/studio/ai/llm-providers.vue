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
import LazyUpsertModal from "#layers/ai/app/components/llmProviders/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["ai"]["llmProvider"]["search"], void>>;
type SearchOutput = RouterOutputs["ai"]["llmProvider"]["search"];

type LlmProvider = SearchOutput["llmProviders"][number];

const overlay = useOverlay();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();

const table = await useResourceTable({
  key: "ai.llmProvider.search",
  query: { limit: MAX_PAGE_SIZE, orderBy: "name", order: "asc" },
  search: async (input: SearchInput) => {
    const result = await $trpc.ai.llmProvider.search.query(input);
    return { rows: result.llmProviders, nextCursor: result.nextCursor };
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
    id: "apiUrl",
    sortable: true,
    filterable: true,
    class: { th: "w-0 min-w-75", td: "w-0 max-w-150 truncate" },
  },
];

const deletePermissions = [AiPermissions.LlmProviderDeleteAll, AiPermissions.LlmProviderDeleteOwn];

const canUpdate = (): boolean => {
  return canAny([
    AiPermissions.LlmProviderReadAll,
    AiPermissions.LlmProviderReadOwn,
    AiPermissions.LlmProviderUpdateAll,
    AiPermissions.LlmProviderUpdateOwn,
  ]);
};

const canDelete = (): boolean => {
  return canAny(deletePermissions);
};

const handleCreateModal = async (): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({});
  const modalResult = (await instance.result) as { llmProvider: LlmProvider | null };
  if (modalResult.llmProvider) {
    table.addRow(modalResult.llmProvider);
  }
};

const handleUpdateModal = async (llmProvider: LlmProvider): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({ id: llmProvider.id });
  const modalResult = (await instance.result) as { llmProvider: LlmProvider | null };
  if (modalResult.llmProvider) {
    table.replaceRow(modalResult.llmProvider);
  }
};

const handleDeleteModal = async (llmProvider: LlmProvider): Promise<void> => {
  const instance = overlay.create(ConfirmDeleteModal, { destroyOnClose: true }).open({
    i18nPrefix: "ai.pages.studio.llmProviders",
    name: llmProvider.name,
    deletePermissions,
    loadAccess: () => $trpc.ai.llmProvider.listAccess.query({ llmProviderId: llmProvider.id }),
    remove: () => $trpc.ai.llmProvider.delete.mutate({ id: llmProvider.id }),
  });
  const { deleted } = (await instance.result) as { deleted: boolean };
  if (deleted) {
    table.removeRow(llmProvider);
  }
};

definePageMeta({
  title: "ai.pages.studio.llmProviders.title",
  description: "ai.pages.studio.llmProviders.description",
  permissions: [
    AiPermissions.LlmProviderCreate,
    AiPermissions.LlmProviderUpdateAll,
    AiPermissions.LlmProviderUpdateOwn,
  ],
});
</script>

<template>
  <ResourceTable
    :table="table"
    :columns="columns"
    :can-delete="canDelete"
    :can-update="canUpdate"
    i18n-prefix="ai.pages.studio.llmProviders"
    :can-create="can(AiPermissions.LlmProviderCreate)"
    @create="() => void handleCreateModal()"
    @delete="(row) => void handleDeleteModal(row)"
    @update="(row) => void handleUpdateModal(row)"
  />
</template>
