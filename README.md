<p align="center">
  <img src="./features/core/public/logo.svg" alt="Capek" width="384" />
</p>

Capek is a self-hosted conversational AI platform.

> [!WARNING]
> This project began as an experiment and remains a work in progress. Breaking changes are expected.

## Features

- Multi-user support with RBAC and Row Level Security (RLS).
- Single-user, OpenID Connect (OIDC) and proxy authentication modes.
- Agent orchestration with triage and specialist patterns.
- OpenAI-compatible LLM provider integration.
- MCP server integration.
- Skills with a sandboxed code interpreter.
- Datasource integration (ClickHouse, MariaDB, PostgreSQL and SQL Server).
- Charts in 2D and 3D (Apache ECharts).
- Sortable and filterable tables with CSV export.
- Dark/Light theme.
- Customizable branding.
- Internationalization.

<figure>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./resources/screenshots/chat-dark.png">
    <img alt="Chat UI showing a conversation" width="1024" src="./resources/screenshots/chat-light.png">
  </picture>
  <figcaption><em>Running locally with llama.cpp (gpt-oss-120b) and a Playwright skill.</em></figcaption>
</figure>

## Tech stack

| Layer     | Technology                                  |
| --------- | ------------------------------------------- |
| Framework | Nuxt                                        |
| Frontend  | Nuxt UI, Tailwind CSS, Pinia                |
| API       | tRPC, Zod                                   |
| Database  | PostgreSQL, Kysely (PGlite for development) |
| Testing   | Vitest, Playwright                          |

## Architecture

The application is composed of [Nuxt layers](https://nuxt.com/docs/guide/going-further/layers), each one providing a feature. See [`features/`](./features/README.md) for how they work and the documentation of each one.

## Development

### Setup

```sh
pnpm install
pnpm dev
```

The application runs in single-user mode at `http://localhost:3000` and automatically logs in as the admin user.

### Configuration

Copy `.env.example` to `.env` and adjust as needed. Key variables:

| Variable                       | Description                                          | Default                 |
| ------------------------------ | ---------------------------------------------------- | ----------------------- |
| `NUXT_DATABASE_URL`            | PostgreSQL connection string or PGlite file path     | `file://./.data/pglite` |
| `NUXT_AUTH_MODE`               | Authentication mode: `single-user`, `oidc`, `proxy`  | `single-user`           |
| `NUXT_ENCRYPTION_KEY`          | Encryption key, 32 bytes in base64                   |                         |
| `NUXT_ENCRYPTION_PREVIOUS_KEY` | Previous encryption key, used while rotating it      |                         |
| `NUXT_LOG_LEVEL`               | Log level: `fatal`, `error`, `warn`, `info`, `debug` | `info`                  |

See `.env.example` for all available configuration options.

## Deployment

### Production build

```sh
pnpm build
pnpm start
```

### Docker

```sh
docker build -t localhost/capek:latest ./
docker run -it --rm -p 127.0.0.1:3000:3000/tcp -e NUXT_ENCRYPTION_KEY="..." localhost/capek:latest
```

### Selecting features

Builds include all features by default. The `FEATURES` environment variable, or build argument in Docker, selects the ones to include as a comma-separated list, and `core` is always included. For example, to build only the core platform:

```sh
FEATURES=core pnpm build
docker build --build-arg FEATURES=core -t localhost/capek:core ./
```

### Docker Compose

The project includes example Compose configurations for reference:

- `compose.base.yaml`: core services (Traefik, PostgreSQL, MCP servers).
- `compose.keycloak.yaml`: extends base with Keycloak for OIDC.
- `compose.dex.yaml`: extends base with Dex for OIDC.
- `compose.proxy.yaml`: extends base with proxy authentication.

Start the full stack:

```sh
docker compose -f ./compose.keycloak.yaml up -d
```

The application is accessible at `https://capek.localhost`.

## License

Licensed under the [European Union Public Licence v. 1.2 or later](./LICENSE) © [Héctor Molinero Fernández](https://hector.molinero.dev). Review the license conditions before use or distribution.
