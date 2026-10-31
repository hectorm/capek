import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2026-04-01",
  future: {
    compatibilityVersion: 5,
  },
  modules: [
    "@nuxt/devtools",
    "@nuxt/eslint",
    "@nuxt/ui",
    "@nuxt/icon",
    "@nuxt/fonts",
    "@nuxtjs/i18n",
    "@nuxtjs/color-mode",
    "@pinia/nuxt",
    "@vueuse/nuxt",
  ],
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
      include: ["../tests/**/*.ts", "../playwright.config.ts", "../vitest.config.ts"],
    },
    appTsConfig: {
      compilerOptions: { tsBuildInfoFile: "../.cache/typescript/app.tsbuildinfo" },
    },
    serverTsConfig: {
      compilerOptions: { tsBuildInfoFile: "../.cache/typescript/server.tsbuildinfo" },
    },
    sharedTsConfig: {
      compilerOptions: { tsBuildInfoFile: "../.cache/typescript/shared.tsbuildinfo" },
    },
    nodeTsConfig: {
      compilerOptions: { tsBuildInfoFile: "../.cache/typescript/node.tsbuildinfo" },
    },
  },
  devtools: {
    enabled: true,
  },
  colorMode: {
    storage: "localStorage",
    storageKey: "color_mode",
    preference: "system",
    fallback: "dark",
  },
  eslint: {
    config: {
      standalone: false,
      autoInit: false,
    },
  },
  fonts: {
    provider: "local",
    families: [{ name: "Inter Variable", provider: "none" }],
  },
  i18n: {
    langDir: "locales",
    defaultLocale: "en",
    locales: [
      {
        name: "English",
        code: "en",
        language: "en-US",
        file: "en-US.ts",
        dir: "ltr",
      },
      {
        name: "Español",
        code: "es",
        language: "es-ES",
        file: "es-ES.ts",
        dir: "ltr",
      },
    ],
    strategy: "no_prefix",
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "i18n_locale",
      alwaysRedirect: true,
      fallbackLocale: "en",
    },
  },
  icon: {
    serverBundle: {
      collections: ["lucide", "simple-icons"],
      externalizeIconsJson: true,
    },
  },
  vueuse: {
    autoImports: false,
  },
  imports: {
    autoImport: false,
    scan: false,
    dirs: [],
  },
  components: {
    dirs: [],
    transform: {
      exclude: [new RegExp(`^${RegExp.escape(import.meta.dirname)}/app/`)],
    },
  },
  css: ["~/assets/css/main.css"],
  build: {
    transpile: ["trpc-nuxt"],
  },
  $production: {
    sourcemap: {
      server: false,
    },
  },
  routeRules: {
    "/**": {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    },
  },
  vite: {
    optimizeDeps: {
      include: ["marked", "dompurify", "superjson", "zod/v4"],
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
      {
        // Disable JIT on client side to avoid problems with eval
        name: "zod-jitless-plugin",
        enforce: "pre",
        resolveId(source, importer, options) {
          return source === "zod/v4" && !options.ssr && importer !== "\0virtual:zod-jitless"
            ? "\0virtual:zod-jitless"
            : null;
        },
        load(id) {
          return id === "\0virtual:zod-jitless"
            ? {
                moduleType: "js",
                code: `import { z } from "zod/v4"; z.config({ jitless: true }); export { z };`,
              }
            : null;
        },
      },
    ],
  },
  nitro: {
    imports: {
      // TODO: remove when "@nuxtjs/i18n" and "trpc-nuxt" stop importing Nitro helpers from "#imports"
      // https://github.com/nuxt-modules/i18n/issues/4175
      imports: [
        { name: "useRuntimeConfig", from: "nitropack/runtime" },
        { name: "eventHandler", from: "h3" },
        { name: "getRequestURL", from: "h3" },
        { name: "getRequestWebStream", from: "h3" },
      ],
    },
    experimental: {
      tasks: true,
      wasm: true,
    },
    tasks: {
      "database:migrate": { description: "Run database migrations" },
      "database:seed": { description: "Run database seeding" },
      "auth:session-cleanup": { description: "Clean up expired sessions" },
      "mcp:session-cleanup": { description: "Clean up stale MCP sessions" },
      "agent:execution-cleanup": { description: "Mark abandoned agent executions as failed" },
    },
    scheduledTasks: {
      "? */24 * * *": ["auth:session-cleanup"],
      "? */22 * * *": ["mcp:session-cleanup"],
      "? */20 * * *": ["agent:execution-cleanup"],
    },
  },
  experimental: {
    typescriptPlugin: true,
    viteEnvironmentApi: true,
    extractAsyncDataHandlers: true,
    enforceModuleCompatibility: true,
  },
  runtimeConfig: {
    databaseUrl: "file://./.data/pglite",
    databaseMaxConnections: 10,
    authMode: "single-user",
    singleUser: {
      username: "admin",
      fullname: "Admin",
      email: "admin@localhost",
    },
    oidc: {
      rootUrl: "http://localhost:3000",
      issuer: "",
      discoveryCacheDurationSec: 60 * 60, // 1 hour
      authorizationEndpoint: "",
      tokenEndpoint: "",
      userinfoEndpoint: "",
      endSessionEndpoint: "",
      jwksUri: "",
      clientId: "",
      clientSecret: "",
      scopes: "openid profile email",
      prompt: "select_account",
      usernameAttributePath: "preferred_username || email",
      fullnameAttributePath: "name || preferred_username",
      emailAttributePath: "email",
      pictureAttributePath: "picture",
      rolesAttributePath: "(type(roles) == 'array' && roles) || `[\"member\"]`",
      groupsAttributePath: "(type(groups) == 'array' && groups) || `[]`",
      allowedPath: "email_verified == `true`",
      syncRoles: true,
      syncGroups: true,
      codeVerifierCookieName: "oidc_code_verifier",
      stateCookieName: "oidc_state",
      nonceCookieName: "oidc_nonce",
    },
    proxy: {
      secret: "changeme",
      secretHeader: "X-Proxy-Secret",
      headerUsername: "X-Forwarded-User",
      headerFullname: "X-Forwarded-Preferred-Username",
      headerEmail: "X-Forwarded-Email",
      headerPicture: "X-Forwarded-Picture",
      headerRoles: "X-Forwarded-Roles",
      headerGroups: "X-Forwarded-Groups",
      syncRoles: true,
      syncGroups: true,
    },
    session: {
      cookieName: "session",
      durationSec: 7 * 24 * 60 * 60, // 7 days
    },
    welcome: {
      quickChats: "",
    },
    branding: {
      name: "Capek",
      logo: "",
      icon: "",
      primaryColor: "sky",
      neutralColor: "zinc",
      radius: "0.125",
    },
    seed: {
      config: "",
    },
    logLevel: "info",
  },
  telemetry: false,
});
