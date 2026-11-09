import type { Migration } from "kysely/migration";

import type { CspContribution } from "#layers/core/server/lib/csp";
import type { SecurityDefinition } from "#layers/core/server/lib/database/security";
import type { SeedDefinition } from "#layers/core/server/lib/seed";
import type { SettingDefinition } from "#layers/core/server/lib/settings/define";

// Server side contribution of a layer (its `server/feature.ts`), extensible through declaration merging
export interface ServerFeature {
  name: string;
  // Features set up before this one, like the ones whose tables it references
  dependsOn?: readonly string[];
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

// Places each feature after the features it depends on, keeping the given order otherwise
export const sortFeatures = (features: readonly ServerFeature[]): ServerFeature[] => {
  const sorted: ServerFeature[] = [];
  const visit = (feature: ServerFeature, path: readonly string[]): void => {
    if (sorted.includes(feature)) {
      return;
    }
    if (path.includes(feature.name)) {
      throw new Error(`Circular feature dependency: ${[...path, feature.name].join(" -> ")}`);
    }
    for (const name of feature.dependsOn ?? []) {
      const dependency = features.find((other) => other.name === name);
      if (dependency === undefined) {
        throw new Error(`Feature "${feature.name}" depends on missing feature "${name}"`);
      }
      visit(dependency, [...path, feature.name]);
    }
    sorted.push(feature);
  };
  for (const feature of features) {
    visit(feature, []);
  }
  return sorted;
};

export const defineServerFeature = (feature: ServerFeature): ServerFeature => feature;
