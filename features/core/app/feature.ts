import { defineAppFeature } from "#layers/core/app/utils/features";
import { CorePermissions } from "#layers/core/shared/rbac";

export default defineAppFeature({
  name: "core",
  userMenu: [
    {
      label: "components.userMenu.studio.label",
      icon: "i-lucide-sparkles",
      to: "/studio",
      tabs: (features) => features.flatMap((feature) => feature.studioTabs ?? []),
      order: 0,
    },
    {
      label: "components.userMenu.settings.label",
      icon: "i-lucide-settings",
      to: "/settings",
      tabs: (features) => features.flatMap((feature) => feature.settingsTabs ?? []),
      order: 100,
    },
  ],
  settingsTabs: [
    {
      label: "pages.settings.general.tab",
      icon: "i-lucide-settings-2",
      to: "/settings",
      exact: true,
      permissions: [CorePermissions.SettingsReadAll],
      order: 0,
    },
    {
      label: "pages.settings.users.tab",
      icon: "i-lucide-user",
      to: "/settings/users",
      permissions: [CorePermissions.UserReadAll],
      order: 10,
    },
    {
      label: "pages.settings.groups.tab",
      icon: "i-lucide-users",
      to: "/settings/groups",
      permissions: [CorePermissions.GroupReadAll],
      order: 20,
    },
  ],
});
