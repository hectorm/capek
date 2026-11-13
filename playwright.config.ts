import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import selection from "./.nuxt/features/selection.json" with { type: "json" };

const isCI = Boolean(process.env.CI);

process.env.PLAYWRIGHT_TMP_DIR ??= mkdtempSync(join(tmpdir(), "playwright-tmp-"));

// Features can provide a "setup.ts" (seed data and environment) and a "global-setup.ts" in "tests/integration/"
interface IntegrationSetup {
  seed?: Record<string, unknown>;
  env?: Record<string, string>;
}

const integrationDirs = selection.enabled
  .map((name) => join(import.meta.dirname, "features", name, "tests/integration"))
  .filter((dir) => existsSync(dir));

const setups = await Promise.all(
  integrationDirs
    .filter((dir) => existsSync(join(dir, "setup.ts")))
    .map(async (dir) => {
      return ((await import(pathToFileURL(join(dir, "setup.ts")).href)) as { default: IntegrationSetup }).default;
    }),
);

// Seed data of different layers is merged, concatenating the lists under the same key
const mergeSeed = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    target[key] =
      Array.isArray(current) && Array.isArray(value)
        ? [...(current as unknown[]), ...(value as unknown[])]
        : isRecord(current) && isRecord(value)
          ? mergeSeed({ ...current }, value)
          : value;
  }
  return target;
};
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
const seed = setups.reduce<Record<string, unknown>>((merged, setup) => mergeSeed(merged, setup.seed ?? {}), {});

export default defineConfig({
  testDir: "./features/",
  testMatch: selection.enabled.map((name) => `features/${name}/tests/integration/**/*.spec.ts`),
  outputDir: "./.cache/playwright/output/",
  globalSetup: integrationDirs.map((dir) => join(dir, "global-setup.ts")).filter((file) => existsSync(file)),
  reporter: isCI ? [["dot"]] : [["list"], ["html", { outputFolder: "./.cache/playwright/report/", open: "never" }]],
  workers: isCI ? 1 : undefined,
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: "http://localhost:51234",
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: "nuxt preview --port=51234 --dotenv=.none",
    url: "http://localhost:51234",
    timeout: 60000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NITRO_CLUSTER_WORKERS: "1",
      NUXT_DATABASE_URL: `file://${process.env.PLAYWRIGHT_TMP_DIR}/pglite`,
      NUXT_AUTH_MODE: "single-user",
      NUXT_BRANDING_NAME: "Test",
      NUXT_SINGLE_USER_USERNAME: "admin",
      NUXT_SINGLE_USER_FULLNAME: "Admin",
      NUXT_SINGLE_USER_EMAIL: "admin@localhost",
      NUXT_SEED_CONFIG: JSON.stringify(seed),
      NUXT_LOG_LEVEL: "debug",
      ...Object.fromEntries(setups.flatMap((setup) => Object.entries(setup.env ?? {}))),
    },
  },
});
