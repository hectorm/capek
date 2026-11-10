import { defineServerFeature } from "#layers/core/server/lib/features/define";
import { datasourcesToolProvider } from "#layers/datasources/server/lib/tools";
import * as m0001_initial from "#layers/datasources/server/migrations/0001_initial";
import { datasourcesSecurity } from "#layers/datasources/server/security";
import { datasourcesSeed } from "#layers/datasources/server/seed";
import { DatasourcesPermissions, DatasourcesRolePermissions } from "#layers/datasources/shared/rbac";

export default defineServerFeature({
  name: "datasources",
  migrations: {
    "0001_initial": m0001_initial,
  },
  security: datasourcesSecurity,
  permissions: Object.values(DatasourcesPermissions),
  rolePermissions: DatasourcesRolePermissions,
  seed: datasourcesSeed,
  tools: [datasourcesToolProvider],
});
