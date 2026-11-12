import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "#layers/core/shared/schema";

// Non-superuser role a superuser connection de-escalates to, so row level security still applies.
export const FALLBACK_ROLE = "app_rls";

export const isSuperuser = async (db: Kysely<Database>): Promise<boolean> => {
  const result = await sql<{ usesuper: boolean }>`SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER`.execute(
    db,
  );
  return result.rows[0]?.usesuper ?? false;
};

export const bypassesRls = async (db: Kysely<Database>): Promise<boolean> => {
  const result = await sql<{ usebypassrls: boolean }>`
    SELECT usebypassrls FROM pg_user WHERE usename = CURRENT_USER
  `.execute(db);
  return result.rows[0]?.usebypassrls ?? false;
};
