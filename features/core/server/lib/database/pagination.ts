import type { SelectQueryBuilder, SqlBool } from "kysely";
import { sql } from "kysely";
import { z } from "zod/v4";

export const PageCursorSchema = z.tuple([z.string(), z.uuid()]);

export type PageCursor = z.infer<typeof PageCursorSchema>;

export interface PageOptions {
  table: string;
  orderBy: string;
  order: "asc" | "desc";
  limit: number;
  cursor?: PageCursor | null;
}

export interface Page<O> {
  rows: O[];
  nextCursor: PageCursor | undefined;
}

export const paginate = async <DB, TB extends keyof DB, O extends { id: string }>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: PageOptions,
): Promise<Page<O>> => {
  const column = sql.ref(`${options.table}.${options.orderBy}`);
  const id = sql.ref(`${options.table}.id`);

  let page = query.select(sql<string>`${column}::TEXT`.as("cursorValue"));
  if (options.cursor) {
    const [value, cursorId] = options.cursor;
    page = page.where(sql<SqlBool>`
      (${column}, ${id}) ${sql.raw(options.order === "asc" ? ">" : "<")} (${value}, ${cursorId})
    `);
  }

  const rows = (await page
    .orderBy(column, options.order)
    .orderBy(id, options.order)
    .limit(options.limit + 1)
    .execute()) as (O & { cursorValue?: string })[];

  let nextCursor: PageCursor | undefined = undefined;
  if (rows.length > options.limit) {
    rows.pop();
    const last = rows.at(-1);
    nextCursor = last?.cursorValue === undefined ? undefined : [last.cursorValue, last.id];
  }
  rows.forEach((row) => delete row.cursorValue);

  return { rows, nextCursor };
};
