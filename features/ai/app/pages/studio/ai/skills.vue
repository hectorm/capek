<script setup lang="ts">
import { useNuxtApp } from "nuxt/app";

import { useOverlay } from "@nuxt/ui/composables/useOverlay";

import type { ResourceTableColumn } from "#layers/core/app/composables/resource-table";
import type { RouterInputs, RouterOutputs } from "#layers/core/app/types/trpc";
import { usePermissions } from "#layers/core/app/composables/permissions";
import { useResourceTable } from "#layers/core/app/composables/resource-table";
import { definePageMeta } from "#layers/core/app/utils/page-meta";
import { AiPermissions } from "#layers/ai/shared/rbac";

import ConfirmDeleteModal from "#layers/core/app/components/ui/ConfirmDeleteModal.vue";
import ResourceTable from "#layers/core/app/components/ui/ResourceTable.vue";
import LazyUpsertModal from "#layers/ai/app/components/skills/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["ai"]["skill"]["search"], void>>;
type SearchOutput = RouterOutputs["ai"]["skill"]["search"];

type Skill = SearchOutput["skills"][number];

const overlay = useOverlay();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();

const table = await useResourceTable({
  key: "ai.skill.search",
  query: { limit: 100, orderBy: "name", order: "asc" },
  search: async (input: SearchInput) => {
    const result = await $trpc.ai.skill.search.query(input);
    return { rows: result.skills, nextCursor: result.nextCursor };
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
];

const canUpdate = (): boolean => {
  return canAny([
    AiPermissions.SkillReadAll,
    AiPermissions.SkillReadOwn,
    AiPermissions.SkillUpdateAll,
    AiPermissions.SkillUpdateOwn,
  ]);
};

const deletePermissions = [AiPermissions.SkillDeleteAll, AiPermissions.SkillDeleteOwn];

const canDelete = (): boolean => {
  return canAny(deletePermissions);
};

const handleCreateModal = async (): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({});
  const modalResult = (await instance.result) as { skill: Skill | null };
  if (modalResult.skill) {
    table.addRow(modalResult.skill);
  }
};

const handleUpdateModal = async (skill: Skill): Promise<void> => {
  const instance = overlay.create(LazyUpsertModal, { destroyOnClose: true }).open({ id: skill.id });
  const modalResult = (await instance.result) as { skill: Skill | null };
  if (modalResult.skill) {
    table.replaceRow(modalResult.skill);
  }
};

const handleDeleteModal = async (skill: Skill): Promise<void> => {
  const instance = overlay.create(ConfirmDeleteModal, { destroyOnClose: true }).open({
    i18nPrefix: "ai.pages.studio.skills",
    name: skill.name,
    deletePermissions,
    loadAccess: () => $trpc.ai.skill.listAccess.query({ skillId: skill.id }),
    remove: () => $trpc.ai.skill.delete.mutate({ id: skill.id }),
  });
  const { deleted } = (await instance.result) as { deleted: boolean };
  if (deleted) {
    table.removeRow(skill);
  }
};

definePageMeta({
  title: "ai.pages.studio.skills.title",
  description: "ai.pages.studio.skills.description",
  permissions: [AiPermissions.SkillCreate, AiPermissions.SkillUpdateAll, AiPermissions.SkillUpdateOwn],
});
</script>

<template>
  <ResourceTable
    :table="table"
    :columns="columns"
    :can-delete="canDelete"
    :can-update="canUpdate"
    i18n-prefix="ai.pages.studio.skills"
    :can-create="can(AiPermissions.SkillCreate)"
    @create="() => void handleCreateModal()"
    @delete="(row) => void handleDeleteModal(row)"
    @update="(row) => void handleUpdateModal(row)"
  />
</template>
