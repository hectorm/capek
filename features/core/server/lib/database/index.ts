import fs from "node:fs";
import path from "node:path";

import type { Transaction } from "kysely";
import { CamelCasePlugin, Kysely, PostgresDialect, sql } from "kysely";
import { useRuntimeConfig } from "nitropack/runtime/config";
import pg from "pg";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import { FALLBACK_ROLE, isSuperuser } from "#layers/core/server/lib/database/rls";
import { useLogger } from "#layers/core/server/lib/logger";

const config = useRuntimeConfig();
const logger = useLogger();

let db: Kysely<Database> | null = null;

const databaseUrl = new URL(config.databaseUrl);
const usingPGlite = databaseUrl.protocol === "file:" || databaseUrl.protocol === "memory:";

let connIsSuperuser = false;

// Configure pg to parse JSONB as JSON objects
pg.types.setTypeParser(pg.types.builtins.JSONB, (val: string) => JSON.parse(val) as unknown);

export const useDb = async (): Promise<Kysely<Database>> => {
  if (!db) {
    let pool: pg.Pool | undefined;

    if (usingPGlite) {
      logger.warn("Using PGlite for database, this is only suitable for development and testing purposes");

      const { PGlite } = await import("@electric-sql/pglite");
      const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");

      let dataDir: string;
      if (databaseUrl.protocol === "file:") {
        dataDir = path.resolve(databaseUrl.href.replace("file://", ""));
        await fs.promises.mkdir(dataDir, { recursive: true });
      } else {
        dataDir = "memory://";
      }

      const pglite = new PGlite(dataDir);
      const server = new PGLiteSocketServer({ db: pglite, host: "127.0.0.1", port: 0 });
      await server.start();

      pool = new pg.Pool({
        connectionString: `postgresql://postgres:postgres@${server.getServerConn()}/app`,
        max: 1,
      });
    } else {
      pool = new pg.Pool({
        connectionString: databaseUrl.toString(),
        max: config.databaseMaxConnections,
      });
    }

    pool.on("connect", () => {
      logger.trace("Database connection established");
    });

    pool.on("acquire", () => {
      logger.trace("Database connection acquired from pool");
    });

    pool.on("release", () => {
      logger.trace("Database connection released back to pool");
    });

    pool.on("remove", () => {
      logger.trace("Database connection removed from pool");
    });

    pool.on("error", (error) => {
      logger.error({ error }, "Database pool error");
    });

    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
      plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
      log(event) {
        if (event.level === "error") {
          logger.debug({ error: event.error }, "Database query error");
        } else {
          logger.trace({ query: event.query }, "Database query");
        }
      },
    });

    connIsSuperuser = await isSuperuser(db);

    if (connIsSuperuser && !usingPGlite) {
      logger.warn(
        "Database connection is a superuser, which bypasses row level security. " +
          `Each request de-escalates to the "${FALLBACK_ROLE}" role so the policies apply, ` +
          "but connecting as a non-superuser role is recommended instead.",
      );
    }
  }

  return db;
};

export const closeDb = async (): Promise<void> => {
  if (db) {
    logger.info("Closing database connection");

    await db.destroy();
    db = null;

    logger.info("Database connection closed");
  }
};

export interface UserTransactionOptions {
  // Sets the GUC that RLS policies check to allow server-authored rows
  trustedWrites?: boolean;
}

export const withUserTransaction = async <T>(
  user: AuthUser,
  callback: (trx: Transaction<Database>) => Promise<T>,
  options: UserTransactionOptions = {},
): Promise<T> => {
  const database = await useDb();
  return database.transaction().execute(async (trx) => {
    await sql`
      SELECT
        ${connIsSuperuser ? sql`set_config('role', ${FALLBACK_ROLE}, true),` : sql``}
        set_config('app.user_id', ${user.id}::UUID::TEXT, true),
        set_config('app.user_groups', ARRAY[${sql.join(user.groups)}]::UUID[]::TEXT, true),
        set_config('app.user_permissions', ARRAY[${sql.join(user.permissions)}]::TEXT[]::TEXT, true),
        set_config('app.trusted_write', ${options.trustedWrites ? "on" : "off"}, true),
        -- The policies trigger JIT compilation in short queries, which is slower than running them
        set_config('jit', 'off', true)
    `.execute(trx);
    return callback(trx);
  });
};
