# Features

Each directory is a [Nuxt layer](https://nuxt.com/docs/guide/going-further/layers) that provides one feature of the application:

- [`core`](./core/README.md): the platform every feature builds on.
- [`ai`](./ai/README.md): the conversational AI feature.
- [`datasources`](./datasources/README.md): the databases that users connect to.

## Layers

Every directory in `features/` is a feature. Features are set up after the ones listed in the `$meta.dependsOn` option of their `nuxt.config.ts`, which have to be part of the build.

They are kept out of the `layers/` directory, which Nuxt registers automatically, so that each build only includes the [selected ones](../README.md#selecting-features). Type checking, linting and tests follow the same selection.

Layers import each other through the `#layers/<name>/` aliases, and `core` cannot import any other layer.

## Adding a feature

A feature is a layer in `features/<name>/`, named `<name>` with the `$meta.name` option of its `nuxt.config.ts`. It contributes any of the following files, which the `core` layer discovers at build time and registers in the `#features/*` modules:

| File                           | Contribution                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `server/feature.ts`            | `defineServerFeature()`: migrations, row level security, permissions, role grants, settings, seed handler, CSP sources and tools |
| `server/trpc/routers/index.ts` | `routers` object merged into the application tRPC router                                                                         |
| `app/feature.ts`               | `defineAppFeature()`: home page, main navigation, sidebar sections, user menu entries, and studio and settings tabs              |
| `shared/*.d.ts`                | Declaration merging into the core registries (e.g. the tables of the `Database` interface)                                       |
| `server/**/*.worker.ts`        | Worker thread, started with `new Worker(new URL("./<name>.worker.ts", import.meta.url))`                                         |

Everything else is merged by Nuxt as usual: pages, layouts, components, plugins, middleware, server routes and tasks, runtime config and i18n messages (each layer declares its locales with the same `code` and `language` as `core`). A feature that does not need the database just omits the migrations and security definitions.

Tests also live in each layer:

- `tests/unit/`: Vitest tests, run as a project named after the layer (`pnpm test:unit --project <name>`).
- `tests/integration/`: Playwright tests, run against the whole application (`pnpm test:chromium features/<name>`). The default export of `setup.ts` provides the seed data and environment variables they need, merged with the ones of other layers, and `global-setup.ts` can start mock services.

## Naming

Except in core, everything that can collide with other features starts with the name of the feature:

- Database tables, indexes, constraints and functions with `<feature>_` (`ai_agents`), as well as permissions and resource types (`ai_agent:read:own`).
- tRPC routers under `$trpc.<feature>`, server routes in `server/api/<feature>/` and tasks in `server/tasks/<feature>/`.
- Pages under `/<feature>/`, also in the Studio and Settings sections of core (`/studio/ai/agents`), while `/` redirects to the `home` page with the lowest `order` among the features.
- Plugins, middleware and layouts as `<feature>-*`.
- Runtime config under `runtimeConfig.<feature>` (`NUXT_<FEATURE>_*` variables), settings as `<feature>.*` and seed configuration in a `<feature>` section.
- i18n keys under `<feature>.*`.
- Tools with `<feature>_` (`datasources_query`).
- Pinia stores under `<feature>.*`, and browser storage keys with a `<feature>` prefix.

The build or the startup fails when a name does not follow this rule, except for Pinia stores and browser storage keys.

## Database

Each feature owns its database changes:

- Migrations are tracked per feature (`kysely_migration_<name>` table) and applied in dependency order.
- Row level security of all features is composed into a single set of statements, reapplied whenever it changes or a migration is added. Resources shared with users and groups (`defineSharedResource()`) and resources owned by a user (`defineOwnedResource()`) are registered in `security.has_access()` and `security.is_owner()`, and `sharedResourcePolicies()` generates their policies.
- Policies are evaluated for each row that a statement reads, so they look up the session in a subquery, like `(SELECT security.can_any(...))`, and check the access to other rows with `hasAccess()` and `isOwner()`. The server refuses to start when a policy looks up the session directly.
- Every table must have forced row level security (e.g. with `protectTable()`), otherwise the server refuses to start.
- When a feature is removed its tables are kept, with row level security enabled and no policies, so they become inaccessible.
- Migrations, policies and functions qualify their tables with the `public` schema, queries do not.
- Lists are paged with `paginate()`, and the ones that can be long also filter by the rows of the user, since the policies alone do not use the indexes.

## Tools

A feature exposes tools to automated callers, such as the agents of the AI feature, with the providers in the `tools` field of its server feature (`defineToolProvider()`). A provider gives the tools of the resources assigned to each caller, like the datasources of an agent, and only of the ones that the user who calls them can use. Without resources it is switched on for each caller instead. Either way, the tools are loaded with the restrictions of that user and act on their behalf.

## Extension points

A feature can let the features that build on it extend it, by adding its own fields to the `AppFeature` and `ServerFeature` interfaces through declaration merging. Those features fill the fields in their `app/feature.ts` and `server/feature.ts` files, and the feature collects them with `getAppFeatures()` and `getServerFeatures()`. For example, a file browser can let other features handle their own file types:

```ts
// features/files/app/utils/handlers.ts
export interface FileHandler {
  extension: string;
  viewer: AsyncComponentLoader<Component>;
}

declare module "#layers/core/app/utils/features" {
  interface AppFeature {
    fileHandlers?: FileHandler[];
  }
}

export const getFileHandlers = (): FileHandler[] => getAppFeatures().flatMap((feature) => feature.fileHandlers ?? []);

// features/reports/app/feature.ts
export default defineAppFeature({
  name: "reports",
  fileHandlers: [{ extension: "report", viewer: () => import("#layers/reports/app/components/ReportViewer.vue") }],
});
```

Since the feature files are imported by the `#features/*` modules, they must not import the code that reads them (`getFileHandlers()` above), which would be an import cycle.
