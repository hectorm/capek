import { defineServerFeature } from "#layers/core/server/lib/features/define";
import * as m0001_initial from "#layers/core/server/migrations/0001_initial";
import { coreSecurity } from "#layers/core/server/security";
import { coreSeed } from "#layers/core/server/seed";
import { coreSettings } from "#layers/core/server/settings";
import { CorePermissions, CoreRolePermissions } from "#layers/core/shared/rbac";

export default defineServerFeature({
  name: "core",
  migrations: {
    "0001_initial": m0001_initial,
  },
  security: coreSecurity,
  permissions: Object.values(CorePermissions),
  rolePermissions: CoreRolePermissions,
  settings: coreSettings,
  seed: coreSeed,
});
