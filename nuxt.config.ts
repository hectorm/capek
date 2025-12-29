import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2026-01-01",
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
      include: ["../tests/**/*.ts", "../playwright.config.ts"],
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
    },
  },
  vueuse: {
    autoImports: false,
  },
  imports: {
    autoImport: false,
    dirs: [],
  },
  components: {
    dirs: [],
  },
  css: ["~/assets/css/main.css"],
  build: {
    transpile: ["trpc-nuxt"],
  },
  routeRules: {
    "/**": {
      headers: {
        "Content-Security-Policy": [
          "default-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "script-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data:",
        ].join("; "),
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    },
  },
  vite: {
    optimizeDeps: {
      include: ["marked", "dompurify"],
    },
    plugins: [
      {
        // Stub jsdom module on client side
        name: "jsdom-stub-plugin",
        enforce: "pre",
        resolveId(source, importer) {
          return source === "jsdom" && this.environment.name === "client" && importer !== "\0virtual:jsdom-stub"
            ? "\0virtual:jsdom-stub"
            : null;
        },
        load(id) {
          return id === "\0virtual:jsdom-stub"
            ? `export const JSDOM = class { constructor() { throw new Error("Stub module"); } };`
            : null;
        },
      },
      {
        // Disable JIT on client side to avoid problems with eval
        name: "zod-jitless-plugin",
        enforce: "pre",
        resolveId(source, importer) {
          return source === "zod/v4" && this.environment.name === "client" && importer !== "\0virtual:zod-jitless"
            ? "\0virtual:zod-jitless"
            : null;
        },
        load(id) {
          return id === "\0virtual:zod-jitless"
            ? `import { z } from "zod/v4"; z.config({ jitless: true }); export { z };`
            : null;
        },
      },
    ],
  },
  nitro: {
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
      discoveryEnabled: true,
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
