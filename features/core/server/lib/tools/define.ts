import type { Kysely } from "kysely";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { SharedResource } from "#layers/core/server/lib/authz/resources";
import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { Database } from "#layers/core/shared/schema";
import type { ToolPart } from "#layers/core/shared/tools";

// JSON schema of the arguments of a tool
export interface ToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolContext {
  // User on whose behalf the tool is called
  user: AuthUser;
  signal?: AbortSignal;
  // Shows something to the user, when the caller has a way to
  show?: (part: ToolPart) => void;
}

// Operation that a feature exposes to automated callers, such as the agents of the AI feature
export interface Tool {
  // Starts with the name of the feature, like "datasources_query"
  name: string;
  description: string;
  parameters: ToolParameters;
  // Returns the result as text, usually JSON, and throws when the call fails
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
  // Markdown that shows the user what a call does, like the query that it runs
  describe?: (args: Record<string, unknown>) => string | undefined;
}

export interface Toolset {
  tools: Tool[];
  // Guidance on how to use the tools, in Markdown
  instructions?: string;
  // Reference documents in Markdown by file name, like the documentation of each resource
  documents?: Readonly<Record<string, string>>;
}

// Provides the tools that a feature gives to a caller
export interface ToolProvider {
  // Name of the feature, followed by `_<name>` when it has several providers
  name: string;
  // i18n key of the label shown where the provider is given to a caller
  label: string;
  // Resources assigned to each caller with `<type>:use` access, or none for tools that are switched on for each caller
  resource?: SharedResource;
  // Tools of the assigned resources that still exist and the user that calls them can use, read as that user
  load: (db: Kysely<Database>, resourceIds: readonly string[]) => Promise<Toolset>;
}

export type ResourceToolProvider = ToolProvider & { resource: SharedResource };

export const hasToolResources = <P extends ToolProvider>(provider: P): provider is P & ResourceToolProvider => {
  return provider.resource !== undefined;
};

export function defineToolProvider(provider: ResourceToolProvider): ResourceToolProvider;
export function defineToolProvider(provider: ToolProvider): ToolProvider;
export function defineToolProvider(provider: ToolProvider): ToolProvider {
  return provider;
}

export type FeatureToolProvider = ToolProvider & { feature: string };

export const collectToolProviders = (features: readonly ServerFeature[]): FeatureToolProvider[] => {
  const providers: FeatureToolProvider[] = [];
  for (const feature of features) {
    for (const provider of feature.tools ?? []) {
      if (providers.some((other) => other.name === provider.name)) {
        throw new Error(`Duplicate tool provider "${provider.name}" in feature "${feature.name}"`);
      }
      const resourceType = provider.resource?.type;
      if (resourceType !== undefined && providers.some((other) => other.resource?.type === resourceType)) {
        throw new Error(`Resource type "${resourceType}" has more than one tool provider`);
      }
      if (feature.name !== "core" && provider.name !== feature.name && !provider.name.startsWith(`${feature.name}_`)) {
        throw new Error(
          `Tool provider "${provider.name}" of feature "${feature.name}" must be named "${feature.name}" or start with "${feature.name}_"`,
        );
      }
      providers.push({ ...provider, feature: feature.name });
    }
  }
  return providers;
};
