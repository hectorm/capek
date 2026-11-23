import { existsSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defaultExclude, defineConfig } from "vitest/config";

import selection from "./.nuxt/features/selection.json" with { type: "json" };

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// One project per included feature with unit tests
const projects = selection.enabled.filter((name) => existsSync(`${rootDir}features/${name}/tests/unit/`));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      // Stub the Nitro runtime config so app modules can be reused in unit tests
      {
        find: /^nitropack\/runtime\/config$/,
        replacement: `${rootDir}features/core/tests/unit/helpers/nitro-config.ts`,
      },
    ],
  },
  test: {
    environment: "node",
    env: { HTTP_PROXY: "", HTTPS_PROXY: "", NO_PROXY: "", http_proxy: "", https_proxy: "", no_proxy: "" },
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: process.env.TEST_DATABASE_URL ? [`${rootDir}features/core/tests/unit/helpers/postgres.ts`] : [],
    exclude: [...defaultExclude, ...selection.excludedFiles],
    projects: projects.map((name) => ({
      extends: true,
      test: {
        name,
        include: [`features/${name}/tests/unit/**/*.test.ts`],
      },
    })),
  },
});
