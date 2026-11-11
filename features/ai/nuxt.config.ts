import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  $meta: {
    name: "ai",
  },
  i18n: {
    langDir: "locales",
    locales: [
      { code: "en", language: "en-US", file: "en-US.ts" },
      { code: "es", language: "es-ES", file: "es-ES.ts" },
    ],
  },
  components: {
    dirs: [],
    transform: {
      exclude: [new RegExp(`^${RegExp.escape(import.meta.dirname)}/app/`)],
    },
  },
  css: [`${import.meta.dirname}/app/assets/css/markdown.css`],
  vite: {
    optimizeDeps: {
      include: ["marked", "dompurify"],
    },
    plugins: [
      {
        // Stub jsdom module on client side
        name: "jsdom-stub-plugin",
        enforce: "pre",
        resolveId(source, importer, options) {
          return source === "jsdom" && !options.ssr && importer !== "\0virtual:jsdom-stub"
            ? "\0virtual:jsdom-stub"
            : null;
        },
        load(id) {
          return id === "\0virtual:jsdom-stub"
            ? {
                moduleType: "js",
                code: `export const JSDOM = class { constructor() { throw new Error("Stub module"); } };`,
              }
            : null;
        },
      },
    ],
  },
  nitro: {
    experimental: {
      wasm: true,
    },
    externals: {
      inline: ["echarts", "echarts-gl"],
    },
    serverAssets: [
      {
        baseName: "echarts",
        dir: dirname(fileURLToPath(import.meta.resolve("echarts/dist/echarts.min.js"))),
        pattern: "echarts.min.js",
      },
      {
        baseName: "echarts-gl",
        dir: dirname(fileURLToPath(import.meta.resolve("echarts-gl/dist/echarts-gl.min.js"))),
        pattern: "echarts-gl.min.js",
      },
    ],
    tasks: {
      "ai:mcp-session-cleanup": { description: "Clean up stale MCP sessions" },
      "ai:agent-execution-cleanup": { description: "Mark abandoned agent executions as failed" },
    },
    scheduledTasks: {
      "*/10 * * * *": ["ai:mcp-session-cleanup", "ai:agent-execution-cleanup"],
    },
  },
  runtimeConfig: {
    ai: {
      quickChats: "",
    },
  },
});
