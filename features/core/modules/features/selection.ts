import { existsSync, readdirSync } from "node:fs";

interface FeatureOption {
  name: string;
  optional: boolean;
}

export const selectFeatures = (available: readonly FeatureOption[], requested = ""): string[] => {
  const names = requested
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const unknown = names.find((name) => !available.some((feature) => feature.name === name));
  if (unknown !== undefined) {
    throw new Error(`Unknown feature "${unknown}" in FEATURES`);
  }

  return available
    .filter(({ name, optional }) => name === "core" || (names.length > 0 ? names.includes(name) : !optional))
    .map(({ name }) => name);
};

const listFeatures = async (root: URL): Promise<FeatureOption[]> => {
  const names = [
    ...readdirSync(new URL("features/", root), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "core")
      .map((entry) => entry.name)
      .toSorted(),
    "core",
  ];

  return Promise.all(
    names.map(async (name) => {
      const { default: config } = (await import(new URL(`features/${name}/nuxt.config.ts`, root).href)) as {
        default: { $meta?: { optional?: unknown } };
      };
      const optional = config.$meta?.optional ?? false;
      if (typeof optional !== "boolean") {
        throw new Error(`Feature "${name}" must set the "$meta.optional" option of its layer to a boolean`);
      }
      return { name, optional };
    }),
  );
};

export const findEnabledFeatures = async (root: URL, requested?: string): Promise<string[]> => {
  if (existsSync(new URL("layers/", root))) {
    throw new Error(`Feature layers must be placed in "features/" instead of "layers/"`);
  }
  return selectFeatures(await listFeatures(root), requested);
};
