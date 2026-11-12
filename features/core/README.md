# Core

This feature is the foundation of the application and the only one included in every build. It takes care of what all features need, like knowing who the users are and what each one is allowed to do, so that the other features only have to deal with their own functionality.

## Authentication

`NUXT_AUTH_MODE` selects how users sign in:

- `single-user`: there is no sign in, every request acts as the admin user configured with the `NUXT_SINGLE_USER_*` variables.
- `oidc`: users sign in with an OpenID Connect provider, configured with the `NUXT_OIDC_*` variables.
- `proxy`: a reverse proxy authenticates users and passes their identity in headers (`X-Forwarded-User`, `X-Forwarded-Email`, etc.), along with the shared secret set in `NUXT_PROXY_SECRET`.

In the `oidc` and `proxy` modes, roles and groups can also be synchronized from the token claims or the headers.

## Roles and permissions

Permissions are named `<resource>:<action>`, followed by a scope when the action applies to existing rows: `all` for every row, `own` for the rows the user owns or was given access to, or `public` for public ones (e.g. `agent:create`, `user:read:own` or `settings:read:public`). Each feature defines its permissions and grants them to the built-in roles: `admin`, `auditor`, `creator` and `member`.

## Row level security

Every user request runs in a transaction that sets the ID, groups and permissions of the user in session variables, which the policies of each table check through the functions of the `security` schema (`security.can_any()`, `security.has_access()`, `security.is_owner()`, etc.). Operations without a user, such as migrations and tasks, are not restricted. Superuser connections switch to the `app_rls` role in those transactions, so the policies still apply. Connections of other roles that bypass row level security are refused.

See the [database section](../README.md#database) of the features guide for how features define their policies.
