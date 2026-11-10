import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "#layers/core/shared/schema";
import { createAccessTable, naturalCollation } from "#layers/core/server/lib/database/schema";
import { SourceResource } from "#layers/datasources/server/lib/resources";

export const up = async (db: Kysely<Database>): Promise<void> => {
  const naturalCs = await naturalCollation(db);

  await db.schema
    .createTable("public.datasourcesSources")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("description", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("documentation", sql`text COLLATE ${naturalCs}`)
    .addColumn("type", sql`varchar(100) COLLATE "C"`, (col) => col.notNull())
    .addColumn("config", "jsonb", (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await createAccessTable(db, SourceResource);
};
