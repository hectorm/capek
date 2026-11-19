import { useNuxtApp } from "nuxt/app";

import { useOverlay } from "@nuxt/ui/composables/useOverlay";

import { DatasourcesPermissions } from "#layers/datasources/shared/rbac";

import ConfirmDeleteModal from "#layers/core/app/components/ui/ConfirmDeleteModal.vue";

const datasourceDeletePermissions = [DatasourcesPermissions.SourceDeleteAll, DatasourcesPermissions.SourceDeleteOwn];

export const useDatasourceDelete = () => {
  const { $trpc } = useNuxtApp();
  const overlay = useOverlay();

  return async ({ id, name }: { id: string; name: string }): Promise<boolean> => {
    const confirmation = overlay.create(ConfirmDeleteModal, { destroyOnClose: true }).open({
      i18nPrefix: "datasources.pages.studio.datasources",
      name,
      deletePermissions: datasourceDeletePermissions,
      loadAccess: () => $trpc.datasources.source.listAccess.query({ sourceId: id }),
      remove: () => $trpc.datasources.source.delete.mutate({ id }),
    });
    const { deleted } = (await confirmation.result) as { deleted: boolean };
    return deleted;
  };
};
