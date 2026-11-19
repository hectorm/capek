# Features

Each directory is a [Nuxt layer](https://nuxt.com/docs/guide/going-further/layers) that provides one feature of the
application:

- [`core`](./core/README.md): the platform every feature builds on.
- [`ai`](./ai/README.md): the conversational AI feature.
- [`datasources`](./datasources/README.md): the databases that users connect to.

## Layers

Nuxt automatically registers layers from `layers/`. Keeping features in `features/` lets each build choose which layers
to load. Every build includes Core. The default build also includes features that leave `$meta.optional` unset or set it
to `false`. An explicit `FEATURES` list selects the other layers, and type checking, linting and tests follow that
selection. See [Selecting features](../README.md#selecting-features).

Declare dependencies in `$meta.dependsOn` in `nuxt.config.ts`. Select those required features in the build. Core lists
them before the dependent feature in the generated registries.

Layers import each other through the `#layers/<name>/` aliases, and Core cannot import any other layer.

## Adding a feature

Set `$meta.name` to the directory name in `features/<name>/nuxt.config.ts`. Core discovers these optional files at build
time to generate the `#features/app`, `#features/server` and `#features/router` modules.

| File                           | Contribution                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `app/feature.ts`               | `defineAppFeature()` registration for the home page, navigation, sidebar, user menu, and Studio and Settings tabs |
| `server/feature.ts`            | `defineServerFeature()` registration for fields of `ServerFeature`, such as migrations, permissions and settings  |
| `server/trpc/routers/index.ts` | Named `routers` export merged into the application tRPC router                                                    |

When features register accessible home pages, `/` redirects to the one with the lowest `order`.

TypeScript picks up declaration merging in `shared/**/*.d.ts`, including tables added to the `Database` interface.
Core's Nitro plugin emits server worker files referenced by
`new Worker(new URL("./<name>.worker.ts", import.meta.url))`.

Everything else is merged by Nuxt as usual: pages, layouts, components, plugins, middleware, server routes and tasks,
runtime config and i18n messages (each layer declares its locales with the same `code` and `language` as Core). A
feature that does not need the database just omits the migrations and security definitions.

Tests also live in each layer:

- `tests/unit/`: Vitest tests, run as a project named after the layer (`pnpm test:unit --project <name>`).
- `tests/integration/`: Playwright tests, run against the whole application (`pnpm test:chromium features/<name>`). The
  default export of `setup.ts` provides the seed data, environment variables and request headers they need, merged with
  the ones of other layers, and `global-setup.ts` can start mock services.

## Naming

Except in Core, everything that can collide with other features starts with the name of the feature:

- Database tables, indexes, constraints and functions with `<feature>_` (`inventory_items`), as well as permissions and
  resource types (`inventory_item:read:own`).
- tRPC routers under `$trpc.<feature>`, server routes in `server/api/<feature>/` and tasks in `server/tasks/<feature>/`.
- Pages under `/<feature>/`, `/studio/<feature>/` or `/settings/<feature>/`, such as `/studio/inventory/items`.
- Plugins, middleware and layouts as `<feature>-*`.
- Runtime config under `runtimeConfig.<feature>` (`NUXT_<FEATURE>_*` variables), settings as `<feature>.*` and seed
  configuration in a `<feature>` section.
- i18n keys under `<feature>.*`.
- Pinia stores under `<feature>.*`, and browser storage keys with a `<feature>` prefix.

The build or the startup fails when a name does not follow this rule, except for Pinia stores and browser storage keys.

## Resource pages

The pages that list a resource to create, edit and delete it are built with `useResourceTable()` and `ResourceTable`,
their dialogs with `AccessFields`, `ResourceLoadError` and `useResourceToast()`, and the deletion with
`ConfirmDeleteModal`. Use `paginate()` for the API endpoints that feed these lists.

They read the messages of the resource under one prefix (`inventory.pages.studio.items`): `table.<column>`,
`actions.<create|update|delete>.<success|error>.<title|description>` and `delete.<title|description|confirm>`.

The `key` of a table and of `usePayloadData()` is unique to what it loads (`inventory.item.search`), since the pages
that use the same key share its data.

## Database

Features register their migrations and security in `server/feature.ts`. Migrations run in dependency order and are
tracked in a `kysely_migration_<name>` table for each feature. Qualify table names with `public` in migrations, policies
and database functions. Application queries use unqualified table names.

Application tables require forced row-level security. Follow the [Core RLS guide](./core/README.md#row-level-security)
for defining policies and choosing transaction scopes.

The policies alone do not use the indexes. If a list can be long, filter the query by the rows of the user as well.

## Extension points

Use `navigation` in `app/feature.ts` to add entries to the main sidebar.

A feature can let the features that build on it extend it, by adding its own fields to the `AppFeature` and
`ServerFeature` interfaces through declaration merging. Those features fill the fields in their `app/feature.ts` and
`server/feature.ts` files, and the feature collects them with `getAppFeatures()` and `getServerFeatures()`. For example,
a file browser can let other features handle their own file types:

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

Since the feature files are imported by the `#features/*` modules, they must not import the code that reads them
(`getFileHandlers()` above), which would be an import cycle.

## Optional integrations

Use a build-time adapter when one feature integrates with another only when both are enabled. Keep the imports from the
companion feature in the adapter.

Declare the integration in `$meta.integrations` in `nuxt.config.ts`, under the name of the companion feature. Paths are
relative to the layer:

| Option     | Value                                                                             |
| ---------- | --------------------------------------------------------------------------------- |
| `adapter`  | Module that imports the companion feature                                         |
| `fallback` | Module with the same exports for the builds without the companion feature         |
| `files`    | Glob patterns of the other files that import the companion feature, such as tests |

Import the integration through the `#features/<feature>-<companion>` alias. Core points the alias to the adapter, or to
the fallback when the companion feature is absent. In that case, type checking, linting and unit tests skip the adapter
and the files.
