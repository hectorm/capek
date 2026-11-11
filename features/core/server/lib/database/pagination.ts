import type { SelectQueryBuilder, SqlBool } from "kysely";
import { sql } from "kysely";

export interface PageOptions {
  table: string;
  orderBy: string;
  order: "asc" | "desc";
  limit: number;
  cursor?: string | null;
}

export interface Page<O> {
  rows: O[];
  nextCursor: string | undefined;
}

export const paginate = async <DB, TB extends keyof DB, O extends { id: string }>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: PageOptions,
): Promise<Page<O>> => {
  const column = sql.ref(`${options.table}.${options.orderBy}`);
  const id = sql.ref(`${options.table}.id`);

  let page = query;
  if (options.cursor) {
    page = page.where(sql<SqlBool>`
      (${column}, ${id}) ${sql.raw(options.order === "asc" ? ">" : "<")} (
        SELECT ${sql.ref(options.orderBy)}, ${sql.ref("id")}
        FROM ${sql.table(options.table)}
        WHERE ${sql.ref("id")} = ${options.cursor}
      )
    `);
  }

  const rows = await page
    .orderBy(column, options.order)
    .orderBy(id, options.order)
    .limit(options.limit + 1)
    .execute();

  let nextCursor: string | undefined = undefined;
  if (rows.length > options.limit) {
    rows.pop();
    nextCursor = rows.at(-1)?.id;
  }

  return { rows, nextCursor };
};
