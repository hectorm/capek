import { existsSync, readdirSync } from "node:fs";
import process from "node:process";

import { defineNuxtConfig } from "nuxt/config";

if (existsSync(new URL("./layers/", import.meta.url))) {
  throw new Error(`Feature layers must be placed in "features/" instead of "layers/"`);
}

const availableFeatures = [
  ...readdirSync(new URL("./features/", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "core")
    .map((entry) => entry.name)
    .toSorted(),
  "core",
];

const requestedFeatures = (process.env.FEATURES ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

const unknownFeature = requestedFeatures.find((name) => !availableFeatures.includes(name));
if (unknownFeature !== undefined) {
  throw new Error(`Unknown feature "${unknownFeature}" in FEATURES`);
}

const enabledFeatures =
  requestedFeatures.length > 0
    ? availableFeatures.filter((name) => name === "core" || requestedFeatures.includes(name))
    : availableFeatures;

const featurePaths = (...paths: string[]): string[] => {
  return enabledFeatures.flatMap((name) => paths.map((path) => `../features/${name}/${path}`));
};

export default defineNuxtConfig({
  extends: enabledFeatures.map((name) => `./features/${name}`),
  srcDir: "app/",
  compatibilityDate: "2026-11-10",
  future: {
    compatibilityVersion: 5,
  },
  modules: ["@nuxt/devtools", "@nuxt/eslint"],
  typescript: {
    tsConfig: {
      compilerOptions: {
        strict: true,
        erasableSyntaxOnly: true,
        verbatimModuleSyntax: true,
        allowUnreachableCode: false,
        allowUnusedLabels: false,
        allowArbitraryExtensions: true,
        noFallthroughCasesInSwitch: true,
        noImplicitAny: true,
        noImplicitOverride: true,
        noImplicitReturns: true,
        noImplicitThis: true,
        noUncheckedIndexedAccess: true,
        noUnusedParameters: true,
        allowJs: true,
        checkJs: true,
        incremental: true,
      },
      include: [
        ...featurePaths("app/**/*", "shared/**/*.d.ts", "*.d.ts", "tests/**/*.ts"),
        "../playwright.config.ts",
        "../vitest.config.ts",
      ],
    },
    appTsConfig: {
      compilerOptions: { tsBuildInfoFile: "../.cache/typescript/app.tsbuildinfo" },
    },
    serverTsConfig: {
      compilerOptions: { tsBuildInfoFile: "../.cache/typescript/server.tsbuildinfo" },
    },
    sharedTsConfig: {
      compilerOptions: { tsBuildInfoFile: "../.cache/typescript/shared.tsbuildinfo" },
      include: featurePaths("shared/**/*", "*.d.ts"),
    },
    nodeTsConfig: {
      compilerOptions: { tsBuildInfoFile: "../.cache/typescript/node.tsbuildinfo" },
      include: featurePaths("nuxt.config.ts", "modules/**/*.ts"),
    },
  },
  devtools: {
    enabled: true,
  },
  eslint: {
    config: {
      standalone: false,
      autoInit: false,
    },
  },
  experimental: {
    typescriptPlugin: true,
  },
  telemetry: false,
});
