import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  $meta: {
    name: "core",
  },
  modules: [
    "@nuxt/ui",
    "@nuxt/icon",
    "@nuxt/fonts",
    "@nuxtjs/i18n",
    "@nuxtjs/color-mode",
    "@pinia/nuxt",
    "@vueuse/nuxt",
  ],
  colorMode: {
    storage: "localStorage",
    storageKey: "color_mode",
    preference: "system",
    fallback: "dark",
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
  css: [`${import.meta.dirname}/app/assets/css/main.css`],
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
      include: ["superjson", "zod/v4"],
    },
    plugins: [
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
    },
    tasks: {
      "database:migrate": { description: "Run database migrations" },
      "database:seed": { description: "Run database seeding" },
      "auth:session-cleanup": { description: "Clean up expired sessions" },
    },
    scheduledTasks: {
      "0 0 * * *": ["auth:session-cleanup"],
    },
  },
  experimental: {
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
      emailVerifiedAttributePath: "email_verified",
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
      syncRoles: false,
      syncGroups: false,
      cacheTtlSec: 30,
    },
    session: {
      cookieName: "session",
      durationSec: 7 * 24 * 60 * 60, // 7 days
      maxDurationSec: 30 * 24 * 60 * 60, // 30 days
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
});
