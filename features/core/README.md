# Core

This feature is the foundation of the application and the only one included in every build. It takes care of what all
features need, like knowing who the users are and what each one is allowed to do, so that the other features only have
to deal with their own functionality.

## Access

Permissions are named `<resource>:<action>`, such as `group:create`. Actions on existing rows can add a scope such as
`all` for every row, `own` for rows accessible through ownership, membership or sharing, or `public` for public rows.
For example, `user:read:own` permits reading your own user record and `settings:read:public` permits reading public
settings.

Features grant permissions to four built-in roles.

- `admin` manages users, groups and settings, and every resource of every feature.
- `auditor` reads all of that and changes only the resources that are shared with them.
- `creator` creates resources and can share them with any user or group.
- `member` works with the resources that are shared with them and can share them with their own groups.

A user's effective permissions combine the roles assigned directly to them and the roles assigned to their groups.

## Configuration

Core reads these variables from the environment. See [`.env.example`](../../.env.example) for examples.

### Database

`NUXT_DATABASE_URL` takes a PostgreSQL connection string or the path of a PGlite directory, and
`NUXT_DATABASE_MAX_CONNECTIONS` sets the size of the connection pool, which is 10 by default. `NUXT_ENCRYPTION_KEY`
holds the key that protects the secrets stored in the database, and `NUXT_ENCRYPTION_PREVIOUS_KEY` the one that it
replaces during a rotation.

### Authentication

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

The endpoints of OIDC come from the discovery document of the issuer, which is cached for
`NUXT_OIDC_DISCOVERY_CACHE_DURATION_SEC`. The `NUXT_OIDC_*_ENDPOINT` variables and `NUXT_OIDC_JWKS_URI` override them.
`NUXT_OIDC_SCOPES` and `NUXT_OIDC_PROMPT` set the scopes and the prompt of the sign-in request, and the
`NUXT_OIDC_*_COOKIE_NAME` variables name the cookies of the sign-in flow. The `NUXT_OIDC_*_ATTRIBUTE_PATH` variables are
[JMESPath](https://jmespath.org) expressions that read the username, full name, email, verified email, picture, roles
and groups from the claims. A user can only sign in when `NUXT_OIDC_ALLOWED_PATH` is true for their claims, which by
default requires a verified email.

The `NUXT_PROXY_HEADER_*` variables and `NUXT_PROXY_SECRET_HEADER` rename the headers of the proxy. The identity that
they carry is cached for `NUXT_PROXY_CACHE_TTL_SEC`, which is 30 seconds by default.

OIDC synchronizes roles and groups from provider claims by default, which `NUXT_OIDC_SYNC_ROLES` and
`NUXT_OIDC_SYNC_GROUPS` turn off. Proxy mode uses local assignments by default and takes them from its role and group
headers with `NUXT_PROXY_SYNC_ROLES` and `NUXT_PROXY_SYNC_GROUPS`.

A session ends after `NUXT_SESSION_DURATION_SEC` without activity, which is 7 days by default. It never lasts longer
than `NUXT_SESSION_MAX_DURATION_SEC`, which is 30 days. `NUXT_SESSION_COOKIE_NAME` names its cookie.

### Branding

The `NUXT_BRANDING_*` variables set the default name, logo, icon, colors and corner radius of the application.
Administrators change them in the Settings. The logo and the icon take the path of a public image or a data URI.

### Seed

`NUXT_SEED_CONFIG` takes a YAML or JSON document, or the path of a file that holds one, with the data to create at
startup. Core reads the `users` and `groups` at the top level and every other feature reads the section with its name.
The seed only creates what is missing, so it leaves the existing rows as they are. Values can take environment variables
as `${VAR}` or `${VAR:-default}`.

When this variable is unset or empty, Core runs only the resource seeds that opt into using their schema defaults.

```yaml
users:
  - username: "alice"
    fullname: "Alice Bennett"
    email: "alice@localhost"
    groups: ["administrators"]
groups:
  - name: "administrators"
    roles: ["admin"]
```

The resources that features seed take an `access` field with the `users` and `groups` that become their `editors` and
`users`. See `compose.base.yaml` for a complete example.

### Outbound connections

For direct connections to destinations users configure, Core allows public IP addresses and private destinations
explicitly allowed by `NUXT_ALLOWED_PRIVATE_HOSTS`. This setting uses the same syntax as `NO_PROXY`, for example
`localhost:9931, .svc.cluster.local, 10.20.0.0/16`.

Core's HTTP client uses `HTTP_PROXY` and `HTTPS_PROXY` to route requests through a proxy. Loopback hosts and
destinations in `NO_PROXY` use a direct connection and follow the same destination policy. Proxies resolve destinations
independently and must enforce their own access rules.

## Extending

### Row-level security

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
  `sharedResourcePolicies()` generates policies for that scope. Add `scopedSelectPolicy()` alongside the custom `SELECT`
  policy of a resource table to enforce the same distinction between read and list permissions.

### Request bodies

Core rejects request bodies without a declared length and limits each body to 2 MiB. A feature sets a different limit
for a route in `bodyLimits` of `server/feature.ts`. A body must arrive within five minutes, except in a route that reads
it through `readUploadBody(event)`, where it times out after five minutes without data.
