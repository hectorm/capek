import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "~~/shared/schema";

// Non-superuser role a superuser connection de-escalates to, so row level security still applies.
export const FALLBACK_ROLE = "capek";

export const isSuperuser = async (db: Kysely<Database>): Promise<boolean> => {
  const result = await sql<{ usesuper: boolean }>`SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER`.execute(
    db,
  );
  return result.rows[0]?.usesuper ?? false;
};
