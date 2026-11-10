import eslint from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import pluginVue from "eslint-plugin-vue";
import { globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

import withNuxt from "./.nuxt/eslint.config.mjs";
import selection from "./.nuxt/features/selection.json" with { type: "json" };

const virtualModulePatterns = [
  {
    regex: "^#(?!components$|layers/|features/)",
    message: "Import from the source package instead of a Nuxt virtual module.",
  },
];

const layerImportPatterns = [
  {
    regex: "^(~~?|@@?)(/|$)",
    message: "Import files of a layer through its #layers/<name>/ alias.",
  },
  {
    regex: "^\\.\\./",
    message: "Import files of a layer through its #layers/<name>/ alias.",
  },
];

export default withNuxt(
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        parser: "@typescript-eslint/parser",
        extraFileExtensions: [".vue"],
        projectService: true,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    settings: {
      features: selection.enabled,
    },
    rules: {
      "no-console": [
        "error",
        {
          allow: ["trace", "debug", "info", "warn", "error"],
        },
      ],
      "no-shadow": [
        "error",
        {
          builtinGlobals: false,
          hoist: "all",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: virtualModulePatterns,
        },
      ],
      "preserve-caught-error": ["off"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-empty-function": [
        "error",
        {
          allow: ["private-constructors"],
        },
      ],
      "vue/block-order": [
        "error",
        {
          order: [["script", "template"], "style"],
        },
      ],
      "vue/attributes-order": [
        "error",
        {
          alphabetical: true,
          sortLineLength: true,
        },
      ],
      "vue/no-undef-components": ["error"],
      "vue/define-macros-order": [
        "error",
        {
          order: ["defineProps", "defineEmits"],
        },
      ],
    },
  },
  {
    files: ["features/**/*.ts", "features/**/*.vue"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...virtualModulePatterns, ...layerImportPatterns] }],
    },
  },
  {
    files: ["features/core/**/*.ts", "features/core/**/*.vue"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^#(?!components$|layers/core/|features/)",
              message: "The core layer can only import from itself and the generated feature registries.",
            },
            ...layerImportPatterns,
          ],
        },
      ],
    },
  },
  {
    files: ["features/*/server/trpc/**/*.ts", "features/*/server/api/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='useDb']",
          message: "Scope request database access with withUserTransaction.",
        },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  globalIgnores([
    "node_modules/**",
    ".cache/**",
    ".data/**",
    ".nitro/**",
    ".nuxt/**",
    ".output/**",
    "dist/**",
    // Excluded features are not part of the TypeScript projects
    ...selection.excluded.map((name) => `features/${name}/**`),
  ]),
).prepend(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  pluginVue.configs["flat/recommended"],
  prettierConfig,
);
