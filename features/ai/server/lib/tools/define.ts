import type { Kysely } from "kysely";

import type { ToolPart } from "#layers/ai/shared/tools";
import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { SharedResource } from "#layers/core/server/lib/authz/resources";
import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { Database } from "#layers/core/shared/schema";

declare module "#layers/core/server/lib/features/define" {
  interface ServerFeature {
    tools?: readonly ToolProvider[];
  }
}

// JSON Schema for a tool's arguments
export interface ToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolContext {
  // Tool calls run on behalf of this user
  user: AuthUser;
  signal?: AbortSignal;
  // Available when the caller can display tool output
  show?: (part: ToolPart) => void;
}

export interface Tool {
  // Tool names start with the feature name, e.g. datasources_query
  name: string;
  description: string;
  parameters: ToolParameters;
  // Tools return text (usually JSON) and throw on failure
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
  // User-visible Markdown describing the call, such as the SQL it runs
  describe?: (args: Record<string, unknown>) => string | undefined;
}

export interface Toolset {
  tools: Tool[];
  // Markdown instructions for the agent
  instructions?: string;
  // Markdown reference documents keyed by filename
  documents?: Readonly<Record<string, string>>;
}

export interface ToolProvider {
  // Provider names use <feature> or <feature>_<name>
  name: string;
  // Translation key for the provider label in agent settings
  label: string;
  // Translation key for the description beside a provider switch
  description?: string;
  // Resource-backed tools require <type>:use access. Other providers use an agent-level switch
  resource?: SharedResource;
  // The caller's transaction limits which assigned resources the provider can load
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
      if (provider.name !== feature.name && !provider.name.startsWith(`${feature.name}_`)) {
        throw new Error(
          `Tool provider "${provider.name}" of feature "${feature.name}" must be named "${feature.name}" or start with "${feature.name}_"`,
        );
      }
      providers.push({ ...provider, feature: feature.name });
    }
  }
  return providers;
};
