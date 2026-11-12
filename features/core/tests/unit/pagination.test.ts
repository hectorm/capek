import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PageCursor } from "#layers/core/server/lib/database/pagination";
import type { Database } from "#layers/core/shared/schema";
import { paginate } from "#layers/core/server/lib/database/pagination";
import { closeDb, createTestDb } from "#layers/core/tests/unit/helpers/db";

let db: Kysely<Database>;

beforeAll(async () => {
  db = await createTestDb();

  await sql`
    INSERT INTO users (username, fullname, email, created_at)
    SELECT 'page' || n, 'Page', 'page' || n || '@example.com',
      TIMESTAMPTZ '2026-01-01 00:00:00.123' + n * INTERVAL '1 microsecond'
    FROM generate_series(1, 7) AS n
  `.execute(db);
});

afterAll(async () => {
  await closeDb();
});

const usernames = async (order: "asc" | "desc", orderBy: string): Promise<string[]> => {
  const all: string[] = [];
  let cursor: PageCursor | undefined;
  for (let pages = 0; pages < 10; pages++) {
    const page = await paginate(
      db.selectFrom("users").select(["users.id", "users.username"]).where("users.fullname", "=", "Page"),
      { table: "users", orderBy, order, limit: 3, cursor },
    );
    all.push(...page.rows.map((row) => row.username));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return all;
};

describe("pagination", () => {
  const users = [1, 2, 3, 4, 5, 6, 7].map((n) => `page${String(n)}`);

  it("returns every row once when their order is closer than a date can tell", async () => {
    expect(await usernames("asc", "createdAt")).toEqual(users);
    expect(await usernames("desc", "createdAt")).toEqual(users.toReversed());
  });

  it("orders by the ID the rows with the same value", async () => {
    const ordered = await db
      .selectFrom("users")
      .select(["username"])
      .where("fullname", "=", "Page")
      .orderBy("id")
      .execute();
    expect(await usernames("asc", "fullname")).toEqual(ordered.map((row) => row.username));
  });

  it("continues after the row of the cursor when it changes or is gone", async () => {
    const pageAfter = (cursor?: PageCursor) => {
      return paginate(
        db.selectFrom("users").select(["users.id", "users.username"]).where("users.fullname", "=", "Page"),
        {
          table: "users",
          orderBy: "username",
          order: "asc",
          limit: 3,
          cursor,
        },
      );
    };
    const first = await pageAfter();
    const lastId = first.rows.at(-1)?.id ?? "";

    await db.updateTable("users").set({ username: "page9" }).where("id", "=", lastId).execute();
    expect((await pageAfter(first.nextCursor)).rows.map((row) => row.username)).toEqual(["page4", "page5", "page6"]);

    await db.deleteFrom("users").where("id", "=", lastId).execute();
    expect((await pageAfter(first.nextCursor)).rows.map((row) => row.username)).toEqual(["page4", "page5", "page6"]);
  });
});
