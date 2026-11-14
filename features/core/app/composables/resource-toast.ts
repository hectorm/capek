import { useI18n } from "vue-i18n";

import { useToast } from "@nuxt/ui/composables/useToast";

// Shows the "actions.<action>.<outcome>" messages of a resource
export const useResourceToast = (i18nPrefix: string) => {
  const i18n = useI18n();
  const toast = useToast();

  const notify = (action: "create" | "update" | "delete", outcome: "success" | "error"): void => {
    toast.add({
      color: outcome,
      title: i18n.t(`${i18nPrefix}.actions.${action}.${outcome}.title`),
      description: i18n.t(`${i18nPrefix}.actions.${action}.${outcome}.description`),
    });
  };

  return { notify };
};
