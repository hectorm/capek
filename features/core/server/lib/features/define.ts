import type { Migration } from "kysely/migration";

import type { CspContribution } from "#layers/core/server/lib/csp";
import type { SecurityDefinition } from "#layers/core/server/lib/database/security";
import type { SeedDefinition } from "#layers/core/server/lib/seed";
import type { SettingDefinition } from "#layers/core/server/lib/settings/define";

// Server side contribution of a layer (its `server/feature.ts`), extensible through declaration merging
export interface ServerFeature {
  name: string;
  // Versioned migrations, applied in name order and tracked separately for each feature
  migrations?: Readonly<Record<string, Migration>>;
  // Row level security definitions, reapplied for all features whenever any of them changes
  security?: SecurityDefinition;
  permissions?: readonly string[];
  rolePermissions?: Readonly<Partial<Record<string, readonly string[]>>>;
  settings?: Readonly<Record<string, SettingDefinition>>;
  // Handler for the section of the seed configuration owned by the feature
  seed?: SeedDefinition;
  // Sources added to the Content Security Policy, like the origins of the content that the feature embeds
  csp?: CspContribution;
}

// Names outside core start with the name of their feature, like "ai_agents" or "ai.quickChats"
export const assertFeaturePrefix = (feature: string, name: string, kind: string, separator = "_"): void => {
  if (feature !== "core" && !name.startsWith(`${feature}${separator}`)) {
    throw new Error(`${kind} "${name}" of feature "${feature}" must start with "${feature}${separator}"`);
  }
};

export const defineServerFeature = (feature: ServerFeature): ServerFeature => feature;
