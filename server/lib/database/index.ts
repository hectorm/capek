import fs from "node:fs";
import path from "node:path";

import type { Transaction } from "kysely";
import { CamelCasePlugin, Kysely, PostgresDialect, sql } from "kysely";
import { useRuntimeConfig } from "nitropack/runtime/config";
import pg from "pg";

import type { AuthUser } from "~~/server/lib/authn/strategies";
import type { Database } from "~~/shared/schema";
import { useLogger } from "~~/server/lib/logger";

const config = useRuntimeConfig();
const logger = useLogger();

let db: Kysely<Database> | null = null;

// Configure pg to parse JSONB as JSON objects
pg.types.setTypeParser(3802, (val: string) => JSON.parse(val) as unknown);

export const useDb = async (): Promise<Kysely<Database>> => {
  if (!db) {
    const databaseUrl = new URL(config.databaseUrl);
    let pool: pg.Pool | undefined;

    if (databaseUrl.protocol === "file:" || databaseUrl.protocol === "memory:") {
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
      plugins: [new CamelCasePlugin()],
      log(event) {
        if (event.level === "error") {
          logger.error({ error: event.error }, "Database query error");
        } else {
          logger.trace({ query: event.query }, "Database query");
        }
      },
    });
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

export const withUserTransaction = async <T>(
  user: AuthUser,
  callback: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> => {
  const database = await useDb();
  return database.transaction().execute(async (trx) => {
    await Promise.all([
      sql`SELECT set_config('app.user_id', ${user.id}::UUID::TEXT, true)`.execute(trx),
      sql`SELECT set_config('app.user_groups', ARRAY[${sql.join(user.groups)}]::UUID[]::TEXT, true)`.execute(trx),
      sql`SELECT set_config('app.user_permissions', ARRAY[${sql.join(user.permissions)}]::TEXT, true)`.execute(trx),
    ]);
    return callback(trx);
  });
};
