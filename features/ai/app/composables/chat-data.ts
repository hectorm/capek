import { onMounted } from "vue";
import { useI18n } from "vue-i18n";

import { useToast } from "@nuxt/ui/composables/useToast";

import { useAgentStore } from "#layers/ai/app/stores/agent";
import { useChatStore } from "#layers/ai/app/stores/chat";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { usePermissions } from "#layers/core/app/composables/permissions";

export const useChatData = (): void => {
  const i18n = useI18n();
  const toast = useToast();

  const { canAny } = usePermissions();

  const agentStore = useAgentStore();
  const chatStore = useChatStore();

  onMounted(async () => {
    try {
      await Promise.all([
        canAny([AiPermissions.ChatListAll, AiPermissions.ChatListOwn]) ? chatStore.fetchSessions() : undefined,
        canAny([AiPermissions.AgentUseAll, AiPermissions.AgentUseOwn]) ? agentStore.fetch() : undefined,
      ]);
    } catch (error) {
      console.error("Failed to fetch initial data", error);
      toast.add({
        color: "error",
        title: i18n.t("pages.welcome.actions.fetchChats.error.title"),
        description: i18n.t("pages.welcome.actions.fetchChats.error.description"),
      });
    }
  });
};
