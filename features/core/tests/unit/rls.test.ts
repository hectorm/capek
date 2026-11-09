import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { Database } from "#layers/core/shared/schema";
import coreFeature from "#layers/core/server/feature";
import { migrateToLatest } from "#layers/core/server/lib/database/migrator";
import { FALLBACK_ROLE } from "#layers/core/server/lib/database/rls";
import { applySecurity, protectTable } from "#layers/core/server/lib/database/security";
import { asUser, closeDb, createTestDb, isSuperuser } from "#layers/core/tests/unit/helpers/db";

let db: Kysely<Database>;

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
const carolGroup = crypto.randomUUID();
const daveGroup = crypto.randomUUID();

beforeAll(async () => {
  db = await createTestDb();

  await db
    .insertInto("users")
    .values([
      { id: alice, username: "alice", fullname: "Alice", email: "alice@example.com" },
      { id: bob, username: "bob", fullname: "Bob", email: "bob@example.com" },
    ])
    .execute();

  await db
    .insertInto("groups")
    .values([
      { id: carolGroup, name: "carol-group", description: "" },
      { id: daveGroup, name: "dave-group", description: "" },
    ])
    .execute();

  await db.insertInto("userGroups").values({ userId: alice, groupId: carolGroup }).execute();
});

afterAll(async () => {
  await closeDb();
});

const visibleIds = (
  table: "users" | "groups",
  principal: { id: string; groups?: string[]; permissions?: string[] },
): Promise<string[]> => {
  return asUser(principal, async (trx) => {
    const rows = await trx.selectFrom(table).select(["id"]).execute();
    return rows.map((r) => r.id);
  });
};

describe("rls core", () => {
  it("uses a non-superuser role so RLS actually applies", async () => {
    expect(await isSuperuser(db)).toBe(true);
    const role = await asUser({ id: alice, permissions: ["user:read:own"] }, async (trx) => {
      const r = await sql<{ roleName: string }>`SELECT CURRENT_USER AS role_name`.execute(trx);
      return r.rows[0]?.roleName;
    });
    expect(role).toBe(FALLBACK_ROLE);
  });

  it("only shows a member their own user", async () => {
    expect(await visibleIds("users", { id: alice, permissions: ["user:read:own"] })).toEqual([alice]);
  });

  it("shows every user to a principal with the all scope", async () => {
    const ids = await visibleIds("users", { id: alice, permissions: ["user:read:all"] });
    expect(ids).toEqual(expect.arrayContaining([alice, bob]));
  });

  it("only shows a member the groups they belong to", async () => {
    const ids = await visibleIds("groups", { id: alice, permissions: ["group:read:own"] });
    expect(ids).toEqual([carolGroup]);
  });

  it("hides everything from a principal with no permissions", async () => {
    expect(await visibleIds("users", { id: alice })).toHaveLength(0);
    expect(await visibleIds("groups", { id: alice })).toHaveLength(0);
  });

  it("denies writes without the matching permission", async () => {
    await expect(
      asUser({ id: alice, permissions: ["user:read:own"] }, (trx) =>
        trx.insertInto("groups").values({ name: "forbidden-group", description: "" }).execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not know any shared resource without other features", async () => {
    const result = await asUser({ id: alice, permissions: ["user:read:own"] }, async (trx) => {
      return sql<{ hasAccess: boolean }>`
        SELECT security.has_access('agent', ${crypto.randomUUID()}::UUID) AS has_access
      `.execute(trx);
    });
    expect(result.rows[0]?.hasAccess).toBe(false);
  });

  it("does not reapply unchanged security", async () => {
    const appliedAt = async (): Promise<string | undefined> => {
      const r = await sql<{ timestamp: string }>`
        SELECT timestamp FROM kysely_migration_repeatable WHERE name = 'security'
      `.execute(db);
      return r.rows[0]?.timestamp;
    };
    const before = await appliedAt();
    await applySecurity(db, [coreFeature]);
    expect(await appliedAt()).toBe(before);
  });

  it("reapplies the security when a migration is added", async () => {
    const checksum = async (): Promise<string | undefined> => {
      const r = await sql<{ checksum: string }>`
        SELECT checksum FROM kysely_migration_repeatable WHERE name = 'security'
      `.execute(db);
      return r.rows[0]?.checksum;
    };
    const before = await checksum();
    const feature: ServerFeature = { name: "extra", migrations: { "0001_noop": { up: () => Promise.resolve() } } };
    try {
      await applySecurity(db, [coreFeature, feature]);
      expect(await checksum()).not.toBe(before);
    } finally {
      await applySecurity(db, [coreFeature]);
    }
    expect(await checksum()).toBe(before);
  });

  it("rejects database objects without the prefix of their feature", async () => {
    const feature: ServerFeature = {
      name: "files",
      migrations: {
        "0001_initial": {
          up: (migrationDb) => migrationDb.schema.createTable("files").addColumn("id", "uuid").execute(),
        },
      },
    };
    try {
      await expect(migrateToLatest(db, [coreFeature, feature])).rejects.toThrow(
        /Database object "files" of feature "files" must start with "files_"/,
      );
    } finally {
      await sql`DROP TABLE IF EXISTS files, kysely_migration_files, kysely_migration_lock_files`.execute(db);
    }
  });

  it("rejects tables without row level security", async () => {
    await sql`CREATE TABLE public.unprotected_objects (id SERIAL PRIMARY KEY)`.execute(db);
    try {
      await expect(applySecurity(db, [coreFeature])).rejects.toThrow(/unprotected_objects/);
    } finally {
      await sql`DROP TABLE public.unprotected_objects`.execute(db);
    }
  });

  it("grants objects created after the security was applied to the fallback role", async () => {
    await sql`CREATE TABLE public.late_objects (id SERIAL PRIMARY KEY)`.execute(db);
    try {
      for (const statement of [
        ...protectTable("late_objects"),
        "CREATE POLICY late_objects_all ON public.late_objects USING (TRUE) WITH CHECK (TRUE)",
      ]) {
        await sql.raw(statement).execute(db);
      }
      await applySecurity(db, [coreFeature]);
      const id = await asUser({ id: alice }, async (trx) => {
        const r = await sql<{ id: number }>`INSERT INTO public.late_objects DEFAULT VALUES RETURNING id`.execute(trx);
        return r.rows[0]?.id;
      });
      expect(id).toBe(1);
    } finally {
      await sql`DROP TABLE public.late_objects`.execute(db);
    }
  });
});
