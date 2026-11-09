import type { Kysely } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";

import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { Database } from "#layers/core/shared/schema";
import { applySecurity } from "#layers/core/server/lib/database/security";
import { assertFeaturePrefix } from "#layers/core/server/lib/features/define";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

class VirtualMigrationProvider implements MigrationProvider {
  readonly #migrations: Readonly<Record<string, Migration>>;

  public constructor(migrations: Readonly<Record<string, Migration>>) {
    this.#migrations = migrations;
  }

  public getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...this.#migrations });
  }
}

// Names of the database objects in the public schema, which all features share
const objectNames = async (db: Kysely<Database>): Promise<Set<string>> => {
  const result = await sql<{ name: string }>`
    SELECT relname AS name FROM pg_class WHERE relnamespace = 'public'::regnamespace
    UNION SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    UNION SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    UNION SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype IN ('d', 'e')
    UNION SELECT collname FROM pg_collation WHERE collnamespace = 'public'::regnamespace
  `.execute(db);
  return new Set(result.rows.map((row) => row.name));
};

// Migrates each feature in the given order, then applies the row level security of all of them
export const migrateToLatest = async (db: Kysely<Database>, features: readonly ServerFeature[]): Promise<void> => {
  const names = features.map((feature) => feature.name);
  const duplicate = names.find((name, i) => names.indexOf(name) !== i);
  if (duplicate !== undefined) {
    throw new Error(`Duplicate feature "${duplicate}"`);
  }

  for (const feature of features) {
    if (!feature.migrations) {
      continue;
    }

    if (!/^[a-z][a-z0-9_]*$/.test(feature.name)) {
      throw new Error(`Invalid feature name "${feature.name}", it must be a lowercase identifier`);
    }

    const migrator = new Migrator({
      db,
      provider: new VirtualMigrationProvider(feature.migrations),
      migrationTableName: `kysely_migration_${feature.name}`,
      migrationLockTableName: `kysely_migration_lock_${feature.name}`,
    });

    const existing = await objectNames(db);
    const { error, results } = await migrator.migrateToLatest();

    results?.forEach((it) => {
      if (it.status === "Success") {
        logger.info({ feature: feature.name, migration: it.migrationName }, "Migration completed");
      } else if (it.status === "NotExecuted") {
        logger.warn({ feature: feature.name, migration: it.migrationName }, "Migration not executed");
      } else {
        logger.error({ feature: feature.name, migration: it.migrationName }, "Migration failed");
      }
    });

    if (error) {
      throw new Error(error instanceof Error ? error.message : JSON.stringify(error));
    }

    for (const name of await objectNames(db)) {
      if (!existing.has(name) && !name.startsWith("kysely_")) {
        assertFeaturePrefix(feature.name, name, "Database object");
      }
    }
  }

  await applySecurity(db, features);
};
