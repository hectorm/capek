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
    tasks: {
      "ai:mcp-session-cleanup": { description: "Clean up stale MCP sessions" },
      "ai:agent-execution-cleanup": { description: "Mark abandoned agent executions as failed" },
    },
    scheduledTasks: {
      "? */22 * * *": ["ai:mcp-session-cleanup"],
      "? */20 * * *": ["ai:agent-execution-cleanup"],
    },
  },
  runtimeConfig: {
    ai: {
      quickChats: "",
    },
  },
});
