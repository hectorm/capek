<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import { useInfiniteScroll } from "@vueuse/core";
import { useNuxtApp } from "nuxt/app";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import { definePageMeta, useOverlay, useToast } from "#imports";

import type { DropdownMenuItem, TableColumn } from "@nuxt/ui";
import UBadge from "@nuxt/ui/components/Badge.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import UDropdownMenu from "@nuxt/ui/components/DropdownMenu.vue";
import UFieldGroup from "@nuxt/ui/components/FieldGroup.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UPopover from "@nuxt/ui/components/Popover.vue";
import USelectMenu from "@nuxt/ui/components/SelectMenu.vue";
import UTable from "@nuxt/ui/components/Table.vue";

import type { RouterInputs, RouterOutputs } from "~/types/trpc";
import { usePermissions } from "~/composables/permissions";
import { Permissions } from "~~/shared/rbac";

import LazyDeleteModal from "~/components/groups/DeleteModal.vue";
import LazyUpsertModal from "~/components/groups/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["group"]["search"], void>>;
type SearchOutput = RouterOutputs["group"]["search"];
type RoleListOutput = RouterOutputs["role"]["list"];

type Group = SearchOutput["groups"][number];

const i18n = useI18n();
const overlay = useOverlay();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();

const upsertModal = overlay.create(LazyUpsertModal);
const deleteModal = overlay.create(LazyDeleteModal);

const table = useTemplateRef<ComponentPublicInstance>("table");
const query = ref<SearchInput>({ limit: 100, orderBy: "name", order: "asc" });
const result = shallowRef<SearchOutput>(await $trpc.group.search.query(query.value));
const groups = shallowRef<Group[]>(result.value.groups);
const roles = shallowRef<RoleListOutput>(await $trpc.role.list.query());
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
      class: { th: "w-0 min-w-75", td: "w-0 max-w-150 truncate" },
    },
  },
  {
    id: "roles",
    accessorKey: "roles",
    accessorFn: (row: Group) => row.roles,
    meta: {
      filterable: true,
      select: true,
      multiple: true,
      items: roles.value.map((r) => r.name),
      class: { th: "w-0 min-w-50", td: "w-0" },
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
      result.value = await $trpc.group.search.query({ ...query.value, cursor: undefined });
      groups.value = result.value.groups;
    } else {
      result.value = await $trpc.group.search.query({ ...query.value, cursor: result.value.nextCursor });
      groups.value = groups.value.concat(result.value.groups);
    }
  } finally {
    loading.value = false;
  }
};

const hasOrder = (column: TableColumn<Group>) => {
  return query.value.orderBy === column.id && !!query.value.order;
};

const setOrder = (column: TableColumn<Group>, order: "asc" | "desc" | undefined) => {
  query.value.orderBy = column.id as SearchInput["orderBy"];
  query.value.order = order;
  void doSearch(true);
};

const hasFilter = (column: TableColumn<Group>) => {
  return query.value.searchBy === column.id && query.value.search && query.value.search.length > 0;
};

const setFilter = (column: TableColumn<Group>, value: string | string[]) => {
  query.value.searchBy = column.id as SearchInput["searchBy"];
  query.value.search = value;
  void doSearch(true);
};

const getDropdownActions = (group: Group): DropdownMenuItem[] => {
  const actions: DropdownMenuItem[] = [];

  if (canAny([Permissions.GroupReadAll, Permissions.GroupUpdateAll])) {
    actions.push({
      label: i18n.t("pages.settings.groups.table.actions.update.label"),
      icon: "i-lucide-edit",
      color: "neutral",
      onSelect: () => void handleUpdateModal(group),
    });
  }

  if (can(Permissions.GroupDeleteAll)) {
    actions.push({
      label: i18n.t("pages.settings.groups.table.actions.delete.label"),
      icon: "i-lucide-trash-2",
      color: "error",
      onSelect: () => void handleDeleteModal(group),
    });
  }

  return actions;
};

const handleCreateModal = async (): Promise<void> => {
  const instance = upsertModal.open({ id: null });
  const modalResult = (await instance.result) as { group: Group | null; error: Error | null };
  if (modalResult.group) {
    groups.value = groups.value.toSpliced(0, 0, modalResult.group);
    toast.add({
      color: "success",
      title: i18n.t("pages.settings.groups.table.actions.create.success.title"),
      description: i18n.t("pages.settings.groups.table.actions.create.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.settings.groups.table.actions.create.error.title"),
      description: i18n.t("pages.settings.groups.table.actions.create.error.description"),
    });
  }
};

const handleUpdateModal = async (group: Group): Promise<void> => {
  const instance = upsertModal.open({ id: group.id });
  const modalResult = (await instance.result) as { group: Group | null; error: Error | null };
  if (modalResult.group) {
    const updatedGroup = modalResult.group;
    const i = groups.value.findIndex((g) => g.id === updatedGroup.id);
    if (i >= 0) groups.value = groups.value.toSpliced(i, 1, updatedGroup);
    toast.add({
      color: "success",
      title: i18n.t("pages.settings.groups.table.actions.update.success.title"),
      description: i18n.t("pages.settings.groups.table.actions.update.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.settings.groups.table.actions.update.error.title"),
      description: i18n.t("pages.settings.groups.table.actions.update.error.description"),
    });
  }
};

const handleDeleteModal = async (group: Group): Promise<void> => {
  const instance = deleteModal.open({ id: group.id });
  const modalResult = (await instance.result) as { deleted: boolean; error: Error | null };
  if (modalResult.deleted) {
    const i = groups.value.findIndex((g) => g.id === group.id);
    if (i >= 0) groups.value = groups.value.toSpliced(i, 1);
    toast.add({
      color: "success",
      title: i18n.t("pages.settings.groups.table.actions.delete.success.title"),
      description: i18n.t("pages.settings.groups.table.actions.delete.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.settings.groups.table.actions.delete.error.title"),
      description: i18n.t("pages.settings.groups.table.actions.delete.error.description"),
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

// Force re-render on locale change
const tableKey = ref<number>(0);
watch(i18n.locale, () => {
  tableKey.value = Date.now();
});

definePageMeta({
  title: "pages.settings.groups.title",
  description: "pages.settings.groups.description",
  permissions: [Permissions.GroupReadAll],
});
</script>

<template>
  <UTable
    ref="table"
    :key="tableKey"
    sticky
    :data="groups"
    :columns="columns"
    :loading="loading"
    :column-pinning="columnPinning"
  >
    <template v-for="{ id, meta } in columns" :key="id" #[`${id}-header`]="{ column }">
      <template v-if="id === 'action'">
        <UButton
          v-if="can(Permissions.GroupCreate)"
          color="neutral"
          variant="ghost"
          icon="i-lucide-plus"
          :aria-label="$t('pages.settings.groups.table.actions.create.label')"
          @click="() => void handleCreateModal()"
        />
      </template>
      <UFieldGroup v-else class="-mx-2.5 flex w-full flex-row" :aria-label="$t(`pages.settings.groups.table.${id}`)">
        <UButton
          v-if="meta.sortable"
          class="flex-1"
          color="neutral"
          variant="ghost"
          :label="$t(`pages.settings.groups.table.${id}`)"
          :aria-label="$t('pages.settings.groups.table.sort')"
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
          :label="$t(`pages.settings.groups.table.${id}`)"
        />
        <UPopover v-if="meta.filterable">
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="$t('pages.settings.groups.table.filter')"
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
                :aria-label="$t('pages.settings.groups.table.search')"
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
                :aria-label="$t('pages.settings.groups.table.search')"
                :model-value="hasFilter(column) && !Array.isArray(query.search) ? query.search : ''"
                @keydown.enter="setFilter(column, $event.target.value)"
              />
            </template>
          </template>
        </UPopover>
      </UFieldGroup>
    </template>
    <template v-for="{ id, meta } in columns" :key="id" #[`${id}-cell`]="{ row, cell }">
      <template v-if="id === 'action'">
        <UDropdownMenu
          v-if="getDropdownActions((row as { original: Group }).original).length > 0"
          :items="getDropdownActions((row as { original: Group }).original)"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ellipsis-vertical"
            :aria-label="$t('pages.settings.groups.table.actions.title')"
          />
        </UDropdownMenu>
      </template>
      <template v-else-if="meta.multiple">
        <UBadge
          v-for="value in cell.getValue()"
          :key="value"
          class="mr-1.5"
          :label="value"
          color="neutral"
          variant="outline"
        />&nbsp;
      </template>
      <template v-else>
        {{ cell.getValue() || "&nbsp;" }}
      </template>
    </template>
    <template #empty>&nbsp;</template>
  </UTable>
</template>
