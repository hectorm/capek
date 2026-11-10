import { defineAppFeature } from "#layers/core/app/utils/features";
import { DatasourcesPermissions } from "#layers/datasources/shared/rbac";

export default defineAppFeature({
  name: "datasources",
  studioTabs: [
    {
      label: "datasources.pages.studio.datasources.tab",
      icon: "i-lucide-database",
      to: "/studio/datasources",
      permissions: [DatasourcesPermissions.SourceCreate],
      order: 40,
    },
  ],
});
