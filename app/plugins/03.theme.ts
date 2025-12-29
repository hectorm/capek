import { defineNuxtPlugin, useAppConfig, useHead } from "nuxt/app";

import { useSettingsStore } from "~/stores/settings";

export default defineNuxtPlugin(() => {
  const appConfig = useAppConfig();
  const settingsStore = useSettingsStore();

  const primaryColorSetting = settingsStore.get("branding.primaryColor");
  if (primaryColorSetting?.value && typeof primaryColorSetting.value === "string") {
    appConfig.ui.colors.primary = primaryColorSetting.value;
  }

  const neutralColorSetting = settingsStore.get("branding.neutralColor");
  if (neutralColorSetting?.value && typeof neutralColorSetting.value === "string") {
    appConfig.ui.colors.neutral = neutralColorSetting.value;
  }

  const radiusSetting = settingsStore.get("branding.radius");
  if (radiusSetting?.value && typeof radiusSetting.value === "string") {
    useHead({
      style: [{ innerHTML: `:root { --ui-radius: ${radiusSetting.value}rem; }`, id: "nuxt-ui-radius" }],
    });
  }
});
