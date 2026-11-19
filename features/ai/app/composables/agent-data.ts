import { onMounted } from "vue";
import { useI18n } from "vue-i18n";

import { useToast } from "@nuxt/ui/composables/useToast";

import { useAgentStore } from "#layers/ai/app/stores/agent";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { usePermissions } from "#layers/core/app/composables/permissions";

export const useAgentData = (): void => {
  const i18n = useI18n();
  const toast = useToast();

  const { canAny } = usePermissions();

  const agentStore = useAgentStore();

  onMounted(async () => {
    if (!canAny([AiPermissions.AgentUseAll, AiPermissions.AgentUseOwn])) {
      return;
    }

    try {
      await agentStore.fetch();
    } catch (error) {
      console.error("Failed to load agents", error);
      toast.add({
        color: "error",
        title: i18n.t("ai.pages.welcome.actions.fetchAgents.error.title"),
        description: i18n.t("ai.pages.welcome.actions.fetchAgents.error.description"),
      });
    }
  });
};
