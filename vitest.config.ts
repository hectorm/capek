import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Stub the Nitro runtime config so app modules can be reused in unit tests.
      { find: /^nitropack\/runtime\/config$/, replacement: `${rootDir}tests/unit/helpers/nitro-config.ts` },
      { find: /^~~\//, replacement: rootDir },
      { find: /^~\//, replacement: `${rootDir}app/` },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
