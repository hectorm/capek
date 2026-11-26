import type { Migration } from "kysely/migration";

import type { CspContribution } from "#layers/core/server/lib/csp";
import type { SecurityDefinition } from "#layers/core/server/lib/database/security";
import type { BodyLimits } from "#layers/core/server/lib/request-body";
import type { SeedDefinition } from "#layers/core/server/lib/seed";
import type { SettingDefinition } from "#layers/core/server/lib/settings/define";
import type { User } from "#layers/core/shared/schema";

// Layers declare server features in server/feature.ts and extend this interface through declaration merging
export interface ServerFeature {
  name: string;
  // Each feature tracks its migrations separately and applies them in name order
  migrations?: Readonly<Record<string, Migration>>;
  // Changing one feature's policies reapplies row-level security across all features
  security?: SecurityDefinition;
  permissions?: readonly string[];
  rolePermissions?: Readonly<Partial<Record<string, readonly string[]>>>;
  settings?: Readonly<Record<string, SettingDefinition>>;
  // Each feature owns its section of the seed configuration
  seed?: SeedDefinition;
  // Features can allow additional sources, such as the origins of embedded content
  csp?: CspContribution;
  // Per-route request body limits in bytes
  bodyLimits?: BodyLimits;
  // Runs after each OIDC sign-in or proxy user sync
  onUserSync?: (event: { user: User; claims: Readonly<Record<string, unknown>> }) => Promise<void>;
}

// Names outside core use the feature prefix, e.g. inventory_items or inventory.pageSize
export const assertFeaturePrefix = (feature: string, name: string, kind: string, separator = "_"): void => {
  if (feature !== "core" && !name.startsWith(`${feature}${separator}`)) {
    throw new Error(`${kind} "${name}" of feature "${feature}" must start with "${feature}${separator}"`);
  }
};

export const defineServerFeature = (feature: ServerFeature): ServerFeature => feature;
