import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  $meta: {
    name: "datasources",
    integrations: {
      ai: {
        adapter: "server/integrations/ai.ts",
        fallback: "server/integrations/fallback.ts",
        files: ["tests/unit/ai-tools.test.ts"],
      },
    },
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
});
