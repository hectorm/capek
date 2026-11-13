import eslint from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import pluginBetterTailwindcss from "eslint-plugin-better-tailwindcss";
import pluginVue from "eslint-plugin-vue";
import { globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

import withNuxt from "./.nuxt/eslint.config.mjs";
import selection from "./.nuxt/features/selection.json" with { type: "json" };
import commentWidthRule from "./tools/eslint-rules/comment-width.js";
import wrappedArrowBodyRule from "./tools/eslint-rules/wrapped-arrow-body.js";

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
    plugins: {
      "better-tailwindcss": pluginBetterTailwindcss,
      capek: {
        rules: {
          "comment-width": commentWidthRule,
          "wrapped-arrow-body": wrappedArrowBodyRule,
        },
      },
    },
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
      "better-tailwindcss": {
        entryPoint: "./features/core/app/assets/css/main.css",
      },
    },
    rules: {
      "capek/comment-width": ["error", { maxLength: 120 }],
      "capek/wrapped-arrow-body": "error",
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
      curly: ["error", "all"],
      eqeqeq: ["error", "smart"],
      "logical-assignment-operators": ["error", "always"],
      "no-else-return": ["error", { allowElseIf: false }],
      "no-implicit-coercion": "error",
      "no-lonely-if": "error",
      "no-useless-concat": "error",
      "no-useless-rename": "error",
      "object-shorthand": "error",
      "operator-assignment": "error",
      "prefer-arrow-callback": "error",
      "prefer-object-spread": "error",
      "prefer-template": "error",
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
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/method-signature-style": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          considerDefaultExhaustiveForUnions: true,
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
      "vue/block-lang": ["error", { script: { lang: "ts" } }],
      "vue/component-api-style": ["error", ["script-setup"]],
      "vue/define-emits-declaration": ["error", "type-based"],
      "vue/define-props-declaration": ["error", "type-based"],
      "vue/html-button-has-type": "error",
      "vue/no-unused-properties": "error",
      "vue/no-unused-refs": "error",
      "vue/no-useless-v-bind": "error",
      "vue/require-typed-ref": "error",
      "better-tailwindcss/enforce-canonical-classes": "error",
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
