# Agent guide

This file tells coding agents how to write code for this repository. Its rules are binding. Read
[`README.md`](./README.md), [`features/README.md`](./features/README.md) and
[`features/core/README.md`](./features/core/README.md) before changing a feature.

## Ground rules

1. Copy, do not invent. Before writing a file, open the one that [References](#references) names for its kind and
   reproduce its structure, names, order and wording.
2. Stop and ask before adding anything that no other feature has. Examples are a dependency, a permission action or
   scope, an access table or role of your own, a database trigger, a UI pattern, an anonymous route or a change to Core.
3. Do not weaken a test, a policy or a lint rule to make something pass. Fix the cause or report it.
4. Run lint early. It enforces kebab-case file names with PascalCase Vue components, CONSTANT_CASE for primitive
   constants, an explicit return type on every function, typed refs, the import aliases and the width of comments.
5. A task is done when `pnpm run lint`, the unit tests of the feature (`pnpm test:unit --project <feature>`) and
   `pnpm test:chromium features/<feature>` pass. Say which of them you did not run.
6. Commit only when asked, with one line in the form `type(scope): subject`. The scope is the feature name and is left
   out when the change spans features.

## References

Core is part of every build, so its files are the references. When another feature has a file of the same kind that is
closer to what you are writing, copy that one.

| When you write                       | Copy                                                          |
| ------------------------------------ | ------------------------------------------------------------- |
| A migration                          | `features/core/server/migrations/0001_initial.ts`             |
| Policies                             | `features/core/server/security.ts`                            |
| A policy pattern                     | The header of `features/core/server/lib/database/security.ts` |
| A router                             | `features/core/server/trpc/routers/group.ts`                  |
| A startup check of the configuration | `features/core/server/plugins/authn.ts`                       |
| A seed section                       | `features/core/server/seed.ts`                                |
| Settings                             | `features/core/server/settings.ts`                            |
| A page that lists a resource         | `features/core/app/pages/settings/groups.vue`                 |
| A dialog with a form                 | `features/core/app/components/groups/UpsertModal.vue`         |
| Locale strings                       | `features/core/i18n/locales/en-US.ts`                         |
| An `rbac`, `rls` or `routers` test   | `features/core/tests/unit/`                                   |
| An integration spec                  | `features/core/tests/integration/settings.spec.ts`            |
| A helper of integration specs        | `features/core/tests/integration/groups.ts`                   |
| A feature README                     | `features/core/README.md`                                     |

## Files

[Layout](./features/README.md#layout) shows where each file of a feature goes.

- A component does not repeat the noun of its directory, as in `groups/UpsertModal.vue`.
- A directory of many things is plural and a file of one thing is singular.
- A file name does not have to match an identifier. `resource-table.ts` exports `useResourceTable`, and router and
  locale keys stay in camelCase.
- A test file is named after what it covers. That is `rbac`, `rls`, `routers`, `api`, `database`, `seed` or the library
  under test.

## Code

- A schema, a resource and a permission map are PascalCase with their kind as suffix, such as `PrincipalAccessSchema`,
  `ItemResource` and `CorePermissions`.
- A feature definition is camelCase with the feature as prefix, such as `coreSettings`.
- Spell names out. The exceptions are `trx`, `ctx`, `col`, `eb`, `oc`, `fn` and a single letter in a one-line callback.
- Do not alias imports or builders.
- Do not keep code for a case that cannot happen.
- Separate the guards, the work and the final log and return of a function with blank lines.

### Function names

A function starts with a verb. A function that only builds a value can take its name, like `sharedResourcePolicies`.

| Verb                                   | Meaning                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `get`, `find`                          | One row. `get` throws when it is missing and `find` returns nothing  |
| `list`, `search`                       | Many rows. `search` pages and filters                                |
| `insert`, `create`, `update`, `delete` | `insert` adds rows as given and the others act on a resource         |
| `sync`, `cleanup`                      | Bring a set in line with a target, and remove what is no longer used |
| `require`                              | Throw unless a condition holds                                       |
| `is`, `has`, `can`                     | Return a boolean                                                     |

## Writing

- Write ASCII characters only, in code, comments, messages and documentation. Other characters are for the translations
  and for the test data that needs them.
- Write prose in plain sentences. Do not join clauses with colons, semicolons or dashes.
- A comment is one terse line that says why, without a final period. Write it only where the code does not say it. The
  header that documents a module is the only exception.
- Write each comment as a single direct statement. Do not add a clause after a comma to justify or explain it, with
  words such as `which`, `so`, `since` or `because`. Write `The lock keeps the cleanup from deleting the row` and not
  `The row stays locked, so the cleanup cannot delete it`.
- A feature README says what the feature does for its users. It then has the Access, Configuration and Extending
  sections that apply, in that order.
- Say "feature" for a unit of the product and "layer" only for the Nuxt mechanism.

## Database

### Tables

- A table is `<feature>_<plural>`.
- Columns are `id uuid`, `created_at` and, for rows that change, `updated_at` as `timestamptz`.
- Text takes the `naturalCollation()` or `"C"` collation. An enumeration is a `varchar` with a `_check` constraint.
- The constraints and indexes that you name are `<table>_<what>_check`, `_fk`, `_idx` and `<table>_unique_<what>`.
  Inline references keep the PostgreSQL defaults.
- Separate the tables of a migration with `////` lines.
- Integrity lives in constraints and authorization in policies. Do not use triggers.
- Declare tables in `shared/schema.ts` as `<Thing>sTable`, `<Thing>`, `New<Thing>` and, when rows are updated,
  `<Thing>Update`. Register them in `shared/database.d.ts`.

### Access

- A shared resource takes the `editor` and `user` roles through `createAccessTable()`. Its access table is
  `<feature>_<resource>_access`.
- A resource whose access is inherited writes its own policies over that table.

### Permissions

- A permission is `<feature>_<resource>:<action>[:<scope>]`. The actions are read, list, create, update, delete and use.
  The scopes are all, own and public.
- Declare permissions in `shared/rbac.ts` as `<Feature>Permissions` and `<Feature>RolePermissions`.
- Members keep to their own rows, auditors only add `read:all` and `list:all`, and personal data has no `:all` holder.

## Server

### Procedures

- A router has one resource. Its procedures are `read`, `list` or `search`, `create`, `update`, `delete` and
  `listAccess`. Any other is a verb with what it acts on, such as `archiveItems`.
- A procedure is `authorizedProcedure([permissions])`, or `protectedProcedure` or `publicProcedure` when no permission
  applies. It has a `z.object()` input when it takes any and an `async ({ ctx, input })` handler.
- Inside its transaction a procedure queries, handles the missing row, then logs and returns.
- Keep HTTP calls and storage I/O outside transactions, unless a row lock has to cover a read.

### API routes

- An API route starts with `const logger = event.context.logger` and `requirePermissions(event.context.user, [...])`.
- It validates with `safeParse()` and answers a failed validation with a logged 400 `"Invalid request query"`.

### Logging and errors

- Log through `ctx.logger`, `event.context.logger` or a module-level `useLogger()`.
- Use `debug` for reads, `info` for writes and `warn` for a missing row or a rejected request.
- Keep the log message fixed, such as `"Group created"`, and put the IDs and other values in the fields.
- Errors are a `TRPCError` or `createError()` written one key per line. Messages read `"Group not found"`,
  `"You don't have permission to update this group"` and `"A group with this name already exists"`.

### Configuration

- Read configuration from `runtimeConfig.<feature>` and validate it in a startup plugin that logs and exits.
- Document each variable in the feature README and add the main ones to `.env.example`.
- Do not copy server configuration to `public`.

## Client

### Scripts

- Import everything explicitly. Packages come first, then `@nuxt/ui`, then `#layers/<name>/` with its type imports
  first, and `.vue` components last.
- Order a script as types, props and emits, composables, then refs, data loading, computed values and the schema and
  state of a form, then functions, watchers and lifecycle hooks, and `definePageMeta()` last.
- A function bound to a template event is `handle*` in a page and `on*` in a component, such as `handleUpsertModal` and
  `onSubmit`.

### Pages

- A resource that is managed in a list has one page and is edited in a modal. A resource that users browse also has an
  `[id]` page.
- IDs go in route parameters and only filters and paging go in the query.
- Load data with `usePayloadData()` or `useAsyncData()` under the key `<feature>.<router>.<procedure>[:<params>]`. A
  page whose data lives in a Pinia store loads it through the store.
- A page that cannot load calls `showError()`, with a 404 for a missing resource.

### Dialogs and actions

- Every dialog is its own `*Modal.vue`, opened with `overlay.create(Modal, { destroyOnClose: true }).open(props)` and
  closed by emitting `close` with a result object.
- A dialog with a form has a zod `schema`, a `reactive` state and `:validate-on="['change']"`.
- Report the result of an action with a toast.
- Delete through a `use<Thing>Delete()` composable when more than one place deletes the resource.
- Pass `isOwner` to `ConfirmDeleteModal` for a resource that no access list covers, such as one that a single user owns.

### Strings

- Use `const i18n = useI18n()`, with `$t` in templates.
- Put every string in both locales under `<feature>.pages.<page>` or `<feature>.components.<directory>.<component>` in
  camelCase.
- Components in `ui/` leave the directory out, and the modals of a resource page use the prefix of the page.
- Copy the wording of the reference locale, such as `"Failed to create group"` and
  `'Are you sure you want to delete the group "{name}"?'`.

## Tests

- Unit tests have `describe` blocks, a module-level `let db` set in `beforeAll()` and `afterAll()` with `closeDb()`.
- Use the helpers of `features/core/tests/unit/helpers/db.ts`.
- A feature with tables has `rbac` and `routers` tests, plus an `rls` test when it writes its own policies.
- Each policy has a case that it allows and a case that it denies.
- Integration tests use `test.describe()` and locators by role or label, scoped to the dialog they act on.
- Repeated steps of integration tests go in a helper module next to the specs.
