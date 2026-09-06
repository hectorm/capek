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

import ConfirmDeleteModal from "~/components/ui/ConfirmDeleteModal.vue";
import LazyUpsertModal from "~/components/llmProviders/UpsertModal.vue";

type SearchInput = NonNullable<Exclude<RouterInputs["llmProvider"]["search"], void>>;
type SearchOutput = RouterOutputs["llmProvider"]["search"];

type LlmProvider = SearchOutput["llmProviders"][number];

const i18n = useI18n();
const overlay = useOverlay();
const toast = useToast();
const { $trpc } = useNuxtApp();
const { can, canAny } = usePermissions();

const upsertModal = overlay.create(LazyUpsertModal);
const deleteModal = overlay.create(ConfirmDeleteModal);

const table = useTemplateRef<ComponentPublicInstance>("table");
const query = ref<SearchInput>({ limit: 100, orderBy: "name", order: "asc" });
const result = shallowRef<SearchOutput>(await $trpc.llmProvider.search.query(query.value));
const llmProviders = shallowRef<LlmProvider[]>(result.value.llmProviders);
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
    id: "apiUrl",
    accessorKey: "apiUrl",
    meta: {
      sortable: true,
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
      result.value = await $trpc.llmProvider.search.query({ ...query.value, cursor: undefined });
      llmProviders.value = result.value.llmProviders;
    } else {
      result.value = await $trpc.llmProvider.search.query({ ...query.value, cursor: result.value.nextCursor });
      llmProviders.value = llmProviders.value.concat(result.value.llmProviders);
    }
  } finally {
    loading.value = false;
  }
};

const hasOrder = (column: TableColumn<LlmProvider>) => {
  return query.value.orderBy === column.id && !!query.value.order;
};

const setOrder = (column: TableColumn<LlmProvider>, order: "asc" | "desc" | undefined) => {
  query.value.orderBy = column.id as SearchInput["orderBy"];
  query.value.order = order;
  void doSearch(true);
};

const hasFilter = (column: TableColumn<LlmProvider>) => {
  return query.value.searchBy === column.id && query.value.search && query.value.search.length > 0;
};

const setFilter = (column: TableColumn<LlmProvider>, value: string | string[]) => {
  query.value.searchBy = column.id as SearchInput["searchBy"];
  query.value.search = value;
  void doSearch(true);
};

const getDropdownActions = (llmProvider: LlmProvider): DropdownMenuItem[] => {
  const actions: DropdownMenuItem[] = [];

  if (
    canAny([
      Permissions.LlmProviderReadAll,
      Permissions.LlmProviderReadOwn,
      Permissions.LlmProviderUpdateAll,
      Permissions.LlmProviderUpdateOwn,
    ])
  ) {
    actions.push({
      label: i18n.t("pages.studio.llmProviders.table.actions.update.label"),
      icon: "i-lucide-edit",
      color: "neutral",
      onSelect: () => void handleUpdateModal(llmProvider),
    });
  }

  if (canAny([Permissions.LlmProviderDeleteAll, Permissions.LlmProviderDeleteOwn])) {
    actions.push({
      label: i18n.t("pages.studio.llmProviders.table.actions.delete.label"),
      icon: "i-lucide-trash-2",
      color: "error",
      onSelect: () => void handleDeleteModal(llmProvider),
    });
  }

  return actions;
};

const handleCreateModal = async (): Promise<void> => {
  const instance = upsertModal.open({});
  const modalResult = (await instance.result) as { llmProvider: LlmProvider | null; error: Error | null };
  if (modalResult.llmProvider) {
    llmProviders.value = llmProviders.value.toSpliced(0, 0, modalResult.llmProvider);
    toast.add({
      color: "success",
      title: i18n.t("pages.studio.llmProviders.table.actions.create.success.title"),
      description: i18n.t("pages.studio.llmProviders.table.actions.create.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.studio.llmProviders.table.actions.create.error.title"),
      description: i18n.t("pages.studio.llmProviders.table.actions.create.error.description"),
    });
  }
};

const handleUpdateModal = async (llmProvider: LlmProvider): Promise<void> => {
  const instance = upsertModal.open({ id: llmProvider.id });
  const modalResult = (await instance.result) as { llmProvider: LlmProvider | null; error: Error | null };
  if (modalResult.llmProvider) {
    const updatedLlmProvider = modalResult.llmProvider;
    const i = llmProviders.value.findIndex((p) => p.id === updatedLlmProvider.id);
    if (i >= 0) llmProviders.value = llmProviders.value.toSpliced(i, 1, updatedLlmProvider);
    toast.add({
      color: "success",
      title: i18n.t("pages.studio.llmProviders.table.actions.update.success.title"),
      description: i18n.t("pages.studio.llmProviders.table.actions.update.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.studio.llmProviders.table.actions.update.error.title"),
      description: i18n.t("pages.studio.llmProviders.table.actions.update.error.description"),
    });
  }
};

const handleDeleteModal = async (llmProvider: LlmProvider): Promise<void> => {
  const instance = deleteModal.open({
    id: llmProvider.id,
    i18nPrefix: "pages.studio.llmProviders",
    deletePermissions: [Permissions.LlmProviderDeleteAll, Permissions.LlmProviderDeleteOwn],
    load: async (id: string) => {
      const [current, access] = await Promise.all([
        $trpc.llmProvider.read.query({ id }),
        $trpc.llmProvider.listAccess.query({ llmProviderId: id }),
      ]);
      return { name: current.name, editorPrincipalIds: access.filter((a) => a.role === "editor").map((a) => a.id) };
    },
    remove: async (id: string) => {
      await $trpc.llmProvider.delete.mutate({ id });
    },
  });
  const modalResult = (await instance.result) as { deleted: boolean; error: Error | null };
  if (modalResult.deleted) {
    const i = llmProviders.value.findIndex((p) => p.id === llmProvider.id);
    if (i >= 0) llmProviders.value = llmProviders.value.toSpliced(i, 1);
    toast.add({
      color: "success",
      title: i18n.t("pages.studio.llmProviders.table.actions.delete.success.title"),
      description: i18n.t("pages.studio.llmProviders.table.actions.delete.success.description"),
    });
  } else if (modalResult.error) {
    toast.add({
      color: "error",
      title: i18n.t("pages.studio.llmProviders.table.actions.delete.error.title"),
      description: i18n.t("pages.studio.llmProviders.table.actions.delete.error.description"),
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
  title: "pages.studio.llmProviders.title",
  description: "pages.studio.llmProviders.description",
  permissions: [Permissions.LlmProviderCreate],
});
</script>

<template>
  <UTable
    ref="table"
    :key="tableKey"
    sticky
    :columns="columns"
    :loading="loading"
    :data="llmProviders"
    :column-pinning="columnPinning"
  >
    <template v-for="{ id, meta } in columns" :key="id" #[`${id}-header`]="{ column }">
      <template v-if="id === 'action'">
        <UButton
          v-if="can(Permissions.LlmProviderCreate)"
          color="neutral"
          variant="ghost"
          icon="i-lucide-plus"
          :aria-label="$t('pages.studio.llmProviders.table.actions.create.label')"
          @click="() => void handleCreateModal()"
        />
      </template>
      <UFieldGroup
        v-else
        class="-mx-2.5 flex w-full flex-row"
        :aria-label="$t(`pages.studio.llmProviders.table.${id}`)"
      >
        <UButton
          v-if="meta.sortable"
          class="flex-1"
          color="neutral"
          variant="ghost"
          :label="$t(`pages.studio.llmProviders.table.${id}`)"
          :aria-label="$t('pages.studio.llmProviders.table.sort')"
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
          :label="$t(`pages.studio.llmProviders.table.${id}`)"
        />
        <UPopover v-if="meta.filterable">
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="$t('pages.studio.llmProviders.table.filter')"
            :icon="hasFilter(column) ? 'i-lucide-list-filter-plus' : 'i-lucide-list-filter'"
          />
          <template #content>
            <UInput
              class="w-64"
              color="neutral"
              variant="ghost"
              icon="i-lucide-search"
              :aria-label="$t('pages.studio.llmProviders.table.search')"
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
          v-if="getDropdownActions((row as { original: LlmProvider }).original).length > 0"
          :items="getDropdownActions((row as { original: LlmProvider }).original)"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ellipsis-vertical"
            :aria-label="$t('pages.studio.llmProviders.table.actions.title')"
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
