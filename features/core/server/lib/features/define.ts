import type { Migration } from "kysely/migration";

import type { BodyLimits } from "#layers/core/server/lib/body-limit";
import type { CspContribution } from "#layers/core/server/lib/csp";
import type { SecurityDefinition } from "#layers/core/server/lib/database/security";
import type { SeedDefinition } from "#layers/core/server/lib/seed";
import type { SettingDefinition } from "#layers/core/server/lib/settings/define";
import type { ToolProvider } from "#layers/core/server/lib/tools/define";
import type { User } from "#layers/core/shared/schema";

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
  // Limits of the request bodies of the routes that accept larger ones
  bodyLimits?: BodyLimits;
  // Tools given to automated callers, like the agents of the AI feature
  tools?: readonly ToolProvider[];
  // Hook run after syncing a user with the identity provider, on each OIDC sign-in and proxy sync
  onUserSync?: (event: { user: User; claims: Readonly<Record<string, unknown>> }) => Promise<void>;
}

// Names outside core start with the name of their feature, like "ai_agents" or "ai.quickChats"
export const assertFeaturePrefix = (feature: string, name: string, kind: string, separator = "_"): void => {
  if (feature !== "core" && !name.startsWith(`${feature}${separator}`)) {
    throw new Error(`${kind} "${name}" of feature "${feature}" must start with "${feature}${separator}"`);
  }
};

export const defineServerFeature = (feature: ServerFeature): ServerFeature => feature;
