import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { addTemplate, defineNuxtModule, getLayerDirectories } from "nuxt/kit";

import type { FeatureNode } from "./order.ts";
import { orderFeatures } from "./order.ts";

interface Feature extends FeatureNode {
  dirs: ReturnType<typeof getLayerDirectories>[number];
  // Name given in the `$meta` option of the layer
  metaName: unknown;
  runtimeConfig: Record<string, unknown>;
  localeFiles: string[];
}

// Options of the i18n module that locate the messages of a layer
interface I18nOptions {
  langDir?: string;
  locales?: (string | { file?: string })[];
}

interface Module {
  feature: string;
  binding: string;
  from: string;
}

// Generates the `#features/*` registries from the feature layers, each one after the features it depends on
export default defineNuxtModule({
  meta: {
    name: "features",
  },
  async setup(_options, nuxt) {
    const featuresDir = join(nuxt.options.rootDir, "features");
    const features: Feature[] = getLayerDirectories(nuxt)
      .map((dirs, i) => {
        const layer = nuxt.options._layers[i];
        const config = layer?.config;
        const meta = (layer?.meta ?? {}) as { name?: unknown; dependsOn?: unknown };
        const i18n = (config as { i18n?: I18nOptions } | undefined)?.i18n;
        return {
          name: basename(dirs.root),
          dirs,
          metaName: meta.name,
          dependsOn: Array.isArray(meta.dependsOn) ? meta.dependsOn.map(String) : [],
          runtimeConfig: config?.runtimeConfig ?? {},
          localeFiles: (i18n?.locales ?? []).flatMap((locale) =>
            typeof locale === "object" && locale.file !== undefined
              ? [join(dirs.root, "i18n", i18n?.langDir ?? "locales", locale.file)]
              : [],
          ),
        };
      })
      .filter((feature) => dirname(feature.dirs.root) === featuresDir);

    checkFeatureIdentity(features);
    await checkFeatureNames(nuxt.options.rootDir, features);

    // Lowest priority first, fails when a feature depends on one that is not part of the build
    const ordered = orderFeatures(features.toReversed());

    // Features in the build, for the tools that do not load the Nuxt configuration
    const enabled = features.map((feature) => feature.name);
    const excluded = readdirSync(featuresDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !enabled.includes(entry.name))
      .map((entry) => entry.name);
    addTemplate({
      filename: "features/selection.json",
      write: true,
      getContents: () => JSON.stringify({ enabled, excluded }, null, 2),
    });

    // Plain JavaScript with type declarations, so it can be bundled from any build directory
    const register = (name: string, js: string[], dts: string[]): void => {
      addTemplate({ filename: `features/${name}.js`, write: true, getContents: () => js.join("\n") });
      addTemplate({ filename: `features/${name}.d.ts`, write: true, getContents: () => dts.join("\n") });
      nuxt.options.alias[`#features/${name}`] = join(nuxt.options.buildDir, `features/${name}`);
    };
    const importPath = (path: string): string => JSON.stringify(path.replaceAll("\\", "/").replace(/\.ts$/, ""));
    const modules = (dir: "app" | "server", file: string): Module[] =>
      ordered
        .map((feature) => ({ feature: feature.name, path: join(feature.dirs[dir], file) }))
        .filter(({ path }) => existsSync(path))
        .map(({ feature, path }, i) => ({ feature, binding: `module${String(i)}`, from: importPath(path) }));

    // Also brings in the declarations that features merge into the core registries
    const registerFeatures = (name: string, list: Module[]): void => {
      register(
        name,
        [
          ...list.map(({ binding, from }) => `import ${binding} from ${from};`),
          `export default [${list.map(({ binding }) => binding).join(", ")}];`,
        ],
        [
          ...list.map(({ binding, from }) => `import type ${binding} from ${from};`),
          `declare const features: readonly [${list.map(({ binding }) => `typeof ${binding}`).join(", ")}];`,
          "export default features;",
        ],
      );
    };
    registerFeatures("server", modules("server", "feature.ts"));
    registerFeatures("app", modules("app", "feature.ts"));

    // Routers of core are at the root of the API, and the ones of every other feature under its name
    const routers = modules("server", "trpc/routers/index.ts");
    const record = ({ feature }: Module, value: string): string =>
      feature === "core" ? value : `{ ${feature}: ${value} }`;
    const init = importPath(join(import.meta.dirname, "../../server/trpc/init.ts"));
    register(
      "router",
      [
        `import { createTRPCRouter, ensureUniqueRouters } from ${init};`,
        ...routers.map(({ binding, from }) => `import { routers as ${binding} } from ${from};`),
        `const records = [${routers.map((router) => record(router, router.binding)).join(", ")}];`,
        "ensureUniqueRouters(records);",
        "export const appRouter = createTRPCRouter(Object.assign({}, ...records));",
      ],
      [
        `import type { createTRPCRouter } from ${init};`,
        ...routers.map(({ binding, from }) => `import type { routers as ${binding} } from ${from};`),
        `type Routers = ${routers.map((router) => record(router, `typeof ${router.binding}`)).join(" & ") || "{}"};`,
        "export declare const appRouter: ReturnType<typeof createTRPCRouter<Routers>>;",
        "export type AppRouter = typeof appRouter;",
      ],
    );
  },
});

// Features are named after their directory, and the name is used in identifiers
const checkFeatureIdentity = (features: readonly Feature[]): void => {
  for (const { name, metaName } of features) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid feature name "${name}", it must be a lowercase identifier`);
    }
    if (metaName !== name) {
      throw new Error(`Feature "${name}" must set the "$meta.name" option of its layer to its name`);
    }
  }
};

// Outside core, the files, runtime config and messages merged between layers start with the name of the feature
const checkFeatureNames = async (rootDir: string, features: readonly Feature[]): Promise<void> => {
  const errors: string[] = [];
  for (const { name, dirs, runtimeConfig, localeFiles } of features) {
    if (name === "core") {
      continue;
    }

    const check = (dir: string, valid: (path: string) => boolean): void => {
      for (const entry of existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }) : []) {
        const path = relative(dir, join(entry.parentPath, entry.name));
        if (entry.isFile() && !valid(path)) {
          errors.push(relative(rootDir, join(dir, path)));
        }
      }
    };
    const inFeatureDir = (path: string): boolean => path.startsWith(`${name}/`);
    const hasFeaturePrefix = (path: string): boolean =>
      basename(path)
        .replace(/^\d+\./, "")
        .startsWith(`${name}-`);

    check(join(dirs.server, "api"), inFeatureDir);
    check(join(dirs.server, "routes"), inFeatureDir);
    check(join(dirs.server, "tasks"), inFeatureDir);
    check(join(dirs.server, "plugins"), hasFeaturePrefix);
    check(dirs.appLayouts, hasFeaturePrefix);
    check(dirs.appMiddleware, hasFeaturePrefix);
    check(dirs.appPlugins, hasFeaturePrefix);
    check(dirs.appPages, (path) =>
      [name, `studio/${name}`, `settings/${name}`].some((dir) => path.startsWith(`${dir}/`)),
    );

    const publicConfig = (runtimeConfig.public ?? {}) as Record<string, unknown>;
    for (const key of [...Object.keys(runtimeConfig), ...Object.keys(publicConfig)]) {
      if (key !== name && key !== "public") {
        errors.push(`runtimeConfig.${key} (${name})`);
      }
    }

    for (const file of localeFiles) {
      const { default: messages } = (await import(pathToFileURL(file).href)) as {
        default: Record<string, unknown> | (() => Record<string, unknown>);
      };
      for (const key of Object.keys(typeof messages === "function" ? messages() : messages)) {
        if (key !== name) {
          errors.push(`${relative(rootDir, file)} (${key})`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Names outside core must start with the name of their feature: ${errors.join(", ")}`);
  }
};
