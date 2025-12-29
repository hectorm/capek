import type { Kysely, Migration, MigrationProvider } from "kysely";
import { Migrator } from "kysely";

import type { Database } from "~~/shared/schema";
import { useLogger } from "~~/server/lib/logger";
import * as migration1 from "~~/server/migrations/1_initial";

const logger = useLogger();

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
  const migrator = new Migrator({
    db,
    provider: new VirtualMigrationProvider({
      "1_initial": migration1,
    }),
  });

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
};
