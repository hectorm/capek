import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Page, PageCursor } from "#layers/core/server/lib/database/pagination";
import type { Database } from "#layers/core/shared/schema";
import { paginate, SearchTermsSchema } from "#layers/core/server/lib/database/pagination";
import { closeDb, createTestDb } from "#layers/core/tests/unit/helpers/db";

let db: Kysely<Database>;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.deleteFrom("users").execute();
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

const page = (
  orderBy: string,
  order: "asc" | "desc",
  cursor?: PageCursor,
): Promise<Page<{ id: string; username: string }>> => {
  const query = db.selectFrom("users").select(["users.id", "users.username"]).where("users.fullname", "=", "Page");
  return paginate(query, { table: "users", orderBy, order, limit: 3, cursor });
};

const usernames = async (orderBy: string, order: "asc" | "desc"): Promise<string[]> => {
  const all: string[] = [];
  let cursor: PageCursor | undefined;
  for (let pages = 0; pages < 10; pages++) {
    const current = await page(orderBy, order, cursor);
    all.push(...current.rows.map((row) => row.username));
    cursor = current.nextCursor;
    if (!cursor) {
      break;
    }
  }
  return all;
};

describe("pagination", () => {
  const users = [1, 2, 3, 4, 5, 6, 7].map((n) => `page${String(n)}`);

  it("accepts one or more search terms and leaves an empty search unfiltered", () => {
    expect(SearchTermsSchema.parse("one")).toEqual(["one"]);
    expect(SearchTermsSchema.parse(["one", "two"])).toEqual(["one", "two"]);
    for (const empty of [undefined, "", []]) {
      expect(SearchTermsSchema.parse(empty)).toEqual([]);
    }
  });

  it("returns every row once when values tie within the date precision", async () => {
    expect(await usernames("createdAt", "asc")).toEqual(users);
    expect(await usernames("createdAt", "desc")).toEqual(users.toReversed());
  });

  it("orders the rows with the same value by ID", async () => {
    const ordered = await db
      .selectFrom("users")
      .select(["username"])
      .where("fullname", "=", "Page")
      .orderBy("id")
      .execute();
    expect(await usernames("fullname", "asc")).toEqual(ordered.map((row) => row.username));
  });

  it("continues after the cursor row when it changes or is gone", async () => {
    const first = await page("username", "asc");
    const lastId = first.rows.at(-1)?.id ?? "";

    await db.updateTable("users").set({ username: "page9" }).where("id", "=", lastId).execute();
    expect((await page("username", "asc", first.nextCursor)).rows.map((row) => row.username)).toEqual([
      "page4",
      "page5",
      "page6",
    ]);

    await db.deleteFrom("users").where("id", "=", lastId).execute();
    expect((await page("username", "asc", first.nextCursor)).rows.map((row) => row.username)).toEqual([
      "page4",
      "page5",
      "page6",
    ]);
  });
});
