# Core

This feature is the foundation of the application and the only one included in every build. It takes care of what all
features need, like knowing who the users are and what each one is allowed to do, so that the other features only have
to deal with their own functionality.

## Authentication

`NUXT_AUTH_MODE` selects how users sign in.

- `single-user` runs requests as the admin user configured with the `NUXT_SINGLE_USER_*` variables, without a sign-in
  step.
- `oidc` uses an OpenID Connect provider. Set `NUXT_OIDC_ISSUER`, `NUXT_OIDC_CLIENT_ID`, `NUXT_OIDC_CLIENT_SECRET` and
  `NUXT_OIDC_ROOT_URL`. Use the public application URL as the root URL and register its `/api/login/callback` URL with
  the provider.
- `proxy` uses a trusted reverse proxy to authenticate users. Configure the proxy to replace incoming authentication
  headers with the authenticated user's identity and the shared secret. The required headers default to
  `X-Forwarded-User`, `X-Forwarded-Preferred-Username`, `X-Forwarded-Email` and `X-Proxy-Secret`. Set
  `NUXT_PROXY_SECRET` to the same secret the proxy sends.

OIDC synchronizes roles and groups from provider claims by default. Proxy mode uses local assignments by default and can
synchronize from headers when configured. See the configuration examples in [`.env.example`](../../.env.example).

## Roles and permissions

Permissions are named `<resource>:<action>`, such as `group:create`. Actions on existing rows can add a scope such as
`all` for every row, `own` for rows accessible through ownership, membership or sharing, or `public` for public rows.
For example, `user:read:own` permits reading your own user record and `settings:read:public` permits reading public
settings.

Features grant permissions to built-in roles such as `admin`, `auditor`, `creator` and `member`. A user's effective
permissions combine the roles assigned directly to them and the roles assigned to their groups.

## Row-level security

User-scoped database operations set the user's ID, groups and permissions in the transaction. Row-level security (RLS)
policies use that context to authorize rows.

Superuser connections switch to the `app_rls` role during user transactions so the policies apply. Core rejects
non-superuser connection roles with `BYPASSRLS`. Migrations and system operations without a user context run with the
configured database role.

Core applies the RLS statements for all enabled features together after migrations. It rebuilds the policies and helpers
when those statements or the migration list changes. Disabling a feature keeps its tables and removes their policies, so
RLS denies access from user transactions.

- Enable and force RLS on application tables with `protectTable()`. Register shared resources with
  `defineSharedResource()` and use `sharedResourcePolicies()` to generate policies for the resource and its grant table.
  Register resources owned by one user with `defineOwnedResource()` and define their policies separately.
- Use `hasAccess()` for grant checks and `isOwner()` for ownership checks. Wrap transaction-level checks in scalar
  subqueries such as `(SELECT security.can_any(...))` so PostgreSQL can evaluate them once per statement. Startup
  rejects application tables without forced RLS and policies that call session helpers directly.
- Use `withUserTransaction()` for writes and other operations that use the caller's baseline RLS policies. Use
  `withResourceTransaction()` for resource reads and lists so RLS also receives the resource type and action.
  `sharedResourcePolicies()` generates policies for that scope. Add `scopedSelectPolicy()` alongside custom `SELECT`
  policies to enforce the same distinction between read and list permissions.

## Outbound connections

For direct connections to destinations users configure, Core allows public IP addresses and private destinations
explicitly allowed by `NUXT_ALLOWED_PRIVATE_HOSTS`. This setting uses the same syntax as `NO_PROXY`, for example
`localhost:9931, .svc.cluster.local, 10.20.0.0/16`.

Core's HTTP client uses `HTTP_PROXY` and `HTTPS_PROXY` to route requests through a proxy. Loopback hosts and
destinations in `NO_PROXY` use a direct connection and follow the same destination policy. Proxies resolve destinations
independently and must enforce their own access rules.
