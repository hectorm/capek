import process from "node:process";

import { defineNuxtConfig } from "nuxt/config";

import { findEnabledFeatures } from "./features/core/modules/features/selection.ts";
import pkg from "./package.json" with { type: "json" };

const enabledFeatures = await findEnabledFeatures(new URL("./", import.meta.url), process.env.FEATURES);

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
  runtimeConfig: {
    httpUserAgent: `${pkg.name}/${pkg.version}`,
  },
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
