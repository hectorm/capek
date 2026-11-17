import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "#layers/core/shared/schema";

// The supplied IDs become the complete set of links for this row
export const syncLinks = async (
  db: Kysely<Database>,
  table: string,
  // Columns that identify the row whose links are being replaced
  owner: Readonly<Record<string, string>>,
  // Column that identifies each linked row
  column: string,
  ids: readonly string[],
): Promise<{ added: number; removed: number }> => {
  const ownedBy = sql.join(
    Object.entries(owner).map(([name, value]) => sql`${sql.ref(name)} = ${value}`),
    sql` AND `,
  );
  const current = await sql<{ id: string }>`
    SELECT ${sql.ref(column)} AS id FROM ${sql.table(table)} WHERE ${ownedBy}
  `.execute(db);

  const currentIds = new Set(current.rows.map((row) => row.id));
  const targetIds = new Set(ids.map((id) => id.toLowerCase()));
  const toAdd = [...targetIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !targetIds.has(id));

  if (toRemove.length > 0) {
    await sql`
      DELETE FROM ${sql.table(table)} WHERE ${ownedBy} AND ${sql.ref(column)} IN (${sql.join(toRemove)})
    `.execute(db);
  }
  if (toAdd.length > 0) {
    await sql`
      INSERT INTO ${sql.table(table)} (${sql.join([...Object.keys(owner), column].map((name) => sql.ref(name)))})
      VALUES ${sql.join(toAdd.map((id) => sql`(${sql.join([...Object.values(owner), id])})`))}
    `.execute(db);
  }

  return { added: toAdd.length, removed: toRemove.length };
};
