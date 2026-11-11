import { aiChartsToolProvider } from "#layers/ai/server/lib/charts";
import * as m0001_initial from "#layers/ai/server/migrations/0001_initial";
import { aiSecurity } from "#layers/ai/server/security";
import { aiSeed } from "#layers/ai/server/seed";
import { aiSettings } from "#layers/ai/server/settings";
import { AiPermissions, AiRolePermissions } from "#layers/ai/shared/rbac";
import { defineServerFeature } from "#layers/core/server/lib/features/define";

export default defineServerFeature({
  name: "ai",
  migrations: {
    "0001_initial": m0001_initial,
  },
  security: aiSecurity,
  permissions: Object.values(AiPermissions),
  rolePermissions: AiRolePermissions,
  settings: aiSettings,
  seed: aiSeed,
  tools: [aiChartsToolProvider],
});
