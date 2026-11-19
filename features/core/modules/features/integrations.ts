import { join } from "node:path";

// Paths are relative to the layer that declares the integration
export interface FeatureIntegration {
  // Module that imports the companion feature
  adapter: string;
  // Module with the same exports for the builds without the companion feature
  fallback: string;
  // Glob patterns of the other files that import the companion feature
  files: readonly string[];
}

export interface IntegratingFeature {
  name: string;
  root: string;
  // Integrations by the name of their companion feature
  integrations: Readonly<Record<string, FeatureIntegration>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

// Read the `$meta.integrations` option of a layer
export const readIntegrations = (feature: string, value: unknown = {}): Record<string, FeatureIntegration> => {
  const invalid = new Error(
    `Feature "${feature}" must set each entry of the "$meta.integrations" option of its layer to an "adapter", a "fallback" and optional "files"`,
  );
  if (!isRecord(value)) {
    throw invalid;
  }

  return Object.fromEntries(
    Object.entries(value).map(([companion, integration]) => {
      if (!isRecord(integration)) {
        throw invalid;
      }
      const { adapter, fallback, files = [] } = integration;
      const isFileList = Array.isArray(files) && files.every((file) => typeof file === "string");
      if (typeof adapter !== "string" || typeof fallback !== "string" || !isFileList) {
        throw invalid;
      }
      return [companion, { adapter, fallback, files }];
    }),
  );
};

// Each "#features/<feature>-<companion>" alias imports the adapter only in the builds with the companion feature
export const resolveIntegrations = (
  features: readonly IntegratingFeature[],
  enabled: readonly string[],
): { aliases: Record<string, string>; excludedPaths: string[] } => {
  const aliases: Record<string, string> = {};
  const excludedPaths: string[] = [];
  for (const { name, root, integrations } of features) {
    for (const [companion, { adapter, fallback, files }] of Object.entries(integrations)) {
      const available = enabled.includes(companion);
      aliases[`#features/${name}-${companion}`] = join(root, available ? adapter : fallback);
      if (!available) {
        excludedPaths.push(...[adapter, ...files].map((file) => join(root, file)));
      }
    }
  }
  return { aliases, excludedPaths };
};
