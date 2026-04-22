import type { Kysely, Migration, MigrationProvider } from "kysely";
import { Migrator, sql } from "kysely";

import type { Database } from "~~/shared/schema";
import { useLogger } from "~~/server/lib/logger";
import * as m1_initial from "~~/server/migrations/1_initial";
import * as mr_security from "~~/server/migrations/R_security";

const logger = useLogger();

const versionedMigrations: Record<string, Migration> = {
  "1_initial": m1_initial,
};

const repeatableMigrations: Record<string, Migration> = {
  R_security: mr_security,
};

class VirtualMigrationProvider implements MigrationProvider {
  readonly #migrations: Record<string, Migration>;

  public constructor(migrations: Record<string, Migration>) {
    this.#migrations = migrations;
  }

  public getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(this.#migrations);
  }
}

export const migrateToLatest = async (db: Kysely<Database>): Promise<void> => {
  const migrator = new Migrator({ db, provider: new VirtualMigrationProvider(versionedMigrations) });
  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === "Success") {
      logger.info({ migration: it.migrationName }, "Migration completed");
    } else if (it.status === "NotExecuted") {
      logger.warn({ migration: it.migrationName }, "Migration not executed");
    } else {
      logger.error({ migration: it.migrationName }, "Migration failed");
    }
  });

  if (error) {
    throw new Error(error instanceof Error ? error.message : JSON.stringify(error));
  }

  await sql`
    CREATE TABLE IF NOT EXISTS kysely_migration_repeatable (
      name VARCHAR(255) PRIMARY KEY,
      checksum TEXT NOT NULL,
      timestamp VARCHAR(255) NOT NULL
    )
  `.execute(db);

  for (const [name, migration] of Object.entries(repeatableMigrations)) {
    const source = migration.up.toString() + (migration.down?.toString() ?? "");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    const checksum = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

    const existing = await sql<{ checksum: string }>`
      SELECT checksum FROM kysely_migration_repeatable WHERE name = ${name}
    `.execute(db);

    if (existing.rows[0]?.checksum === checksum) {
      continue;
    }

    logger.info({ migration: name }, "Applying repeatable migration");

    await db.transaction().execute(async (trx) => {
      await migration.down?.(trx);
      await migration.up(trx);
      await sql`
        INSERT INTO kysely_migration_repeatable (name, checksum, timestamp)
        VALUES (${name}, ${checksum}, ${new Date().toISOString()})
        ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, timestamp = EXCLUDED.timestamp
      `.execute(trx);
    });

    logger.info({ migration: name }, "Repeatable migration applied");
  }
};
