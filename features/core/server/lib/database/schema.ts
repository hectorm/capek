import type { Kysely, RawBuilder } from "kysely";
import { sql } from "kysely";

import type { SharedResource } from "#layers/core/server/lib/authz/resources";
import type { Database } from "#layers/core/shared/schema";

// Natural sort collation for user facing text, created by the core migrations if ICU is available
export const naturalCollation = async (db: Kysely<Database>): Promise<RawBuilder<unknown>> => {
  const result = await sql<{ found: boolean }>`
    SELECT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'natural_cs') AS found
  `.execute(db);
  return result.rows[0]?.found ? sql.raw("natural_cs") : sql.raw(`"default"`);
};

export const createAccessTable = async (db: Kysely<Database>, resource: SharedResource): Promise<void> => {
  const { table, accessTable, foreignKey } = resource;
  const naturalCs = await naturalCollation(db);

  await db.schema
    .createTable(`public.${accessTable}`)
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn(foreignKey, "uuid", (col) => col.references(`public.${table}.id`).onDelete("cascade").notNull())
    .addColumn("user_id", "uuid", (col) => col.references("public.users.id").onDelete("cascade"))
    .addColumn("group_id", "uuid", (col) => col.references("public.groups.id").onDelete("cascade"))
    .addColumn("role", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addCheckConstraint(
      `${accessTable}_user_or_group_check`,
      sql`(user_id IS NOT NULL AND group_id IS NULL) OR (user_id IS NULL AND group_id IS NOT NULL)`,
    )
    .addCheckConstraint(`${accessTable}_role_check`, sql`role IN ('editor', 'user')`)
    .execute();

  await db.schema
    .createIndex(`${accessTable}_${foreignKey}_idx`)
    .on(`public.${accessTable}`)
    .column(foreignKey)
    .execute();

  await db.schema
    .createIndex(`${accessTable}_user_id_idx`)
    .on(`public.${accessTable}`)
    .column("user_id")
    .where(sql.ref("user_id"), "is not", null)
    .execute();

  await db.schema
    .createIndex(`${accessTable}_group_id_idx`)
    .on(`public.${accessTable}`)
    .column("group_id")
    .where(sql.ref("group_id"), "is not", null)
    .execute();

  await db.schema
    .createIndex(`${accessTable}_unique_user`)
    .on(`public.${accessTable}`)
    .columns([foreignKey, "user_id", "role"])
    .where(sql.ref("user_id"), "is not", null)
    .unique()
    .execute();

  await db.schema
    .createIndex(`${accessTable}_unique_group`)
    .on(`public.${accessTable}`)
    .columns([foreignKey, "group_id", "role"])
    .where(sql.ref("group_id"), "is not", null)
    .unique()
    .execute();
};
