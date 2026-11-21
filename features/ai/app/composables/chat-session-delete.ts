import { useI18n } from "vue-i18n";

import { useOverlay } from "@nuxt/ui/composables/useOverlay";

import { useChatStore } from "#layers/ai/app/stores/chat";
import { AiPermissions } from "#layers/ai/shared/rbac";

import ConfirmDeleteModal from "#layers/core/app/components/ui/ConfirmDeleteModal.vue";

export type ChatSessionDelete = (session: { id: string; title?: string | null }) => Promise<boolean>;

const chatSessionDeletePermissions = [AiPermissions.ChatDeleteAll, AiPermissions.ChatDeleteOwn];

export const useChatSessionDelete = (): ChatSessionDelete => {
  const i18n = useI18n();
  const overlay = useOverlay();
  const chatStore = useChatStore();

  return async ({ id, title }) => {
    const confirmation = overlay.create(ConfirmDeleteModal, { destroyOnClose: true }).open({
      i18nPrefix: "ai.pages.chat.session",
      name: title ?? i18n.t("ai.pages.chat.untitled"),
      deletePermissions: chatSessionDeletePermissions,
      // A chat belongs to one user and has no access list
      isOwner: true,
      remove: () => chatStore.deleteSession(id),
    });
    const { deleted } = (await confirmation.result) as { deleted: boolean };
    return deleted;
  };
};
