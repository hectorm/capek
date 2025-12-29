<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import { useInfiniteScroll } from "@vueuse/core";
import { useNuxtApp } from "nuxt/app";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import { definePageMeta, useOverlay, useToast } from "#imports";

import type { DropdownMenuItem, TableColumn } from "@nuxt/ui";
import UButton from "@nuxt/ui/components/Button.vue";
import UDropdownMenu from "@nuxt/ui/components/DropdownMenu.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UPopover from "@nuxt/ui/components/Popover.vue";
import UTable from "@nuxt/ui/components/Table.vue";

import type { RouterInputs, RouterOutputs } from "~/types/trpc";
import { usePermissions } from "~/composables/permissions";
import { Permissions } from "~~/shared/rbac";

import LazyDeleteModal from "~/components/skills/DeleteModal.vue";
import LazyUpsertModal from "~/components/skills/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["skill"]["search"], void>>;
type SearchOutput = RouterOutputs["skill"]["search"];

type Skill = SearchOutput["items"][number];

const i18n = useI18n();
const overlay = useOverlay();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();

const upsertModal = overlay.create(LazyUpsertModal);
const deleteModal = overlay.create(LazyDeleteModal);

const table = useTemplateRef<ComponentPublicInstance>("table");
const query = ref<SearchInput>({ limit: 100, orderBy: "name", order: "asc" });
const result = shallowRef<SearchOutput>(await $trpc.skill.search.query(query.value));
const skills = shallowRef<Skill[]>(result.value.items);
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
      result.value = await $trpc.skill.search.query({ ...query.value, cursor: undefined });
      skills.value = result.value.items;
    } else {
      result.value = await $trpc.skill.search.query({ ...query.value, cursor: result.value.nextCursor });
      skills.value = skills.value.concat(result.value.items);
    }
  } finally {
    loading.value = false;
  }
};

const hasOrder = (column: TableColumn<Skill>) => {
  return query.value.orderBy === column.id && !!query.value.order;
};

const setOrder = (column: TableColumn<Skill>, order: "asc" | "desc" | undefined) => {
  query.value.orderBy = column.id as SearchInput["orderBy"];
  query.value.order = order;
  void doSearch(true);
};

const hasFilter = (column: TableColumn<Skill>) => {
  return query.value.searchBy === column.id && query.value.search && query.value.search.length > 0;
};

const setFilter = (column: TableColumn<Skill>, value: string | string[]) => {
  query.value.searchBy = column.id as SearchInput["searchBy"];
  query.value.search = value;
  void doSearch(true);
};

const getDropdownActions = (skill: Skill): DropdownMenuItem[] => {
  const dropdownActions: DropdownMenuItem[] = [];

  if (
    canAny([Permissions.SkillReadAll, Permissions.SkillReadOwn, Permissions.SkillUpdateAll, Permissions.SkillUpdateOwn])
  ) {
    dropdownActions.push({
      label: i18n.t("pages.studio.skills.table.actions.update.label"),
      icon: "i-lucide-edit",
      color: "neutral",
      onSelect: () => void handleUpdateModal(skill),
    });
  }

  if (canAny([Permissions.SkillDeleteAll, Permissions.SkillDeleteOwn])) {
    dropdownActions.push({
      label: i18n.t("pages.studio.skills.table.actions.delete.label"),
      icon: "i-lucide-trash-2",
      color: "error",
      onSelect: () => void handleDeleteModal(skill),
    });
  }

  return dropdownActions;
};

const handleCreateModal = async (): Promise<void> => {
  const instance = upsertModal.open({});
  const modalResult = (await instance.result) as { skill: Skill | null; error: Error | null };
  if (modalResult.skill) {
    skills.value = skills.value.toSpliced(0, 0, modalResult.skill);
    toast.add({
      color: "success",
      title: i18n.t("pages.studio.skills.table.actions.create.success.title"),
      description: i18n.t("pages.studio.skills.table.actions.create.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.studio.skills.table.actions.create.error.title"),
      description: i18n.t("pages.studio.skills.table.actions.create.error.description"),
    });
  }
};

const handleUpdateModal = async (skill: Skill): Promise<void> => {
  const instance = upsertModal.open({ id: skill.id });
  const modalResult = (await instance.result) as { skill: Skill | null; error: Error | null };
  if (modalResult.skill) {
    const updatedSkill = modalResult.skill;
    const i = skills.value.findIndex((s) => s.id === updatedSkill.id);
    if (i >= 0) skills.value = skills.value.toSpliced(i, 1, updatedSkill);
    toast.add({
      color: "success",
      title: i18n.t("pages.studio.skills.table.actions.update.success.title"),
      description: i18n.t("pages.studio.skills.table.actions.update.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.studio.skills.table.actions.update.error.title"),
      description: i18n.t("pages.studio.skills.table.actions.update.error.description"),
    });
  }
};

const handleDeleteModal = async (skill: Skill): Promise<void> => {
  const instance = deleteModal.open({ id: skill.id });
  const modalResult = (await instance.result) as { deleted: boolean; error: Error | null };
  if (modalResult.deleted) {
    const i = skills.value.findIndex((s) => s.id === skill.id);
    if (i >= 0) skills.value = skills.value.toSpliced(i, 1);
    toast.add({
      color: "success",
      title: i18n.t("pages.studio.skills.table.actions.delete.success.title"),
      description: i18n.t("pages.studio.skills.table.actions.delete.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.studio.skills.table.actions.delete.error.title"),
      description: i18n.t("pages.studio.skills.table.actions.delete.error.description"),
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
  title: "pages.studio.skills.title",
  description: "pages.studio.skills.description",
  permissions: [Permissions.SkillCreate],
});
</script>

<template>
  <UTable
    ref="table"
    :key="tableKey"
    sticky
    :data="skills"
    :columns="columns"
    :loading="loading"
    :column-pinning="columnPinning"
  >
    <template v-for="{ id, meta } in columns" :key="id" #[`${id}-header`]="{ column }">
      <template v-if="id === 'action'">
        <UButton
          v-if="can(Permissions.SkillCreate)"
          color="neutral"
          variant="ghost"
          icon="i-lucide-plus"
          :aria-label="$t('pages.studio.skills.table.actions.create.label')"
          @click="() => void handleCreateModal()"
        />
      </template>
      <UFieldGroup v-else class="-mx-2.5 flex w-full flex-row" :aria-label="$t(`pages.studio.skills.table.${id}`)">
        <UButton
          v-if="meta.sortable"
          class="flex-1"
          color="neutral"
          variant="ghost"
          :label="$t(`pages.studio.skills.table.${id}`)"
          :aria-label="$t('pages.studio.skills.table.sort')"
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
          :label="$t(`pages.studio.skills.table.${id}`)"
        />
        <UPopover v-if="meta.filterable">
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="$t('pages.studio.skills.table.filter')"
            :icon="hasFilter(column) ? 'i-lucide-list-filter-plus' : 'i-lucide-list-filter'"
          />
          <template #content>
            <UInput
              class="w-64"
              color="neutral"
              variant="ghost"
              icon="i-lucide-search"
              :aria-label="$t('pages.studio.skills.table.search')"
              :model-value="hasFilter(column) && !Array.isArray(query.search) ? query.search : ''"
              @keydown.enter="setFilter(column, $event.target.value)"
            />
          </template>
        </UPopover>
      </UFieldGroup>
    </template>
    <template v-for="{ id } in columns" :key="id" #[`${id}-cell`]="{ row, cell }">
      <template v-if="id === 'action'">
        <UDropdownMenu
          v-if="getDropdownActions((row as { original: Skill }).original).length > 0"
          :items="getDropdownActions((row as { original: Skill }).original)"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ellipsis-vertical"
            :aria-label="$t('pages.studio.skills.table.actions.title')"
          />
        </UDropdownMenu>
      </template>
      <template v-else>
        {{ cell.getValue() || "&nbsp;" }}
      </template>
    </template>
    <template #empty>&nbsp;</template>
  </UTable>
</template>
