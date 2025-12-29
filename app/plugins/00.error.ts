import { defineNuxtPlugin } from "nuxt/app";
import { useI18n } from "vue-i18n";

import { useToast } from "#imports";

export default defineNuxtPlugin((nuxtApp) => {
  const toast = useToast();

  const errorHandler = (...args: unknown[]) => {
    console.error(...args);

    let errorTitle;
    let errorDescription;
    try {
      const i18n = useI18n();
      errorTitle = i18n.t("errors.unexpected.title");
      errorDescription = i18n.t("errors.unexpected.description");
    } catch {
      errorTitle = "Unexpected error";
      errorDescription = "An unexpected error occurred. Please refresh the page.";
    }

    toast.add({
      color: "error",
      title: errorTitle,
      description: errorDescription,
    });
  };

  nuxtApp.vueApp.config.errorHandler = (error, instance, info) => {
    errorHandler("Vue error boundary caught", { error, instance, info });
  };

  if (import.meta.client) {
    window.addEventListener("unhandledrejection", (event) => {
      errorHandler("Unhandled promise rejection caught", { event });
    });
  }
});
