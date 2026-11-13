import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { Database } from "#layers/core/shared/schema";
import type { TestPrincipal } from "#layers/core/tests/unit/helpers/db";
import coreFeature from "#layers/core/server/feature";
import { defineSharedResource } from "#layers/core/server/lib/authz/resources";
import { migrateToLatest } from "#layers/core/server/lib/database/migrator";
import { FALLBACK_ROLE } from "#layers/core/server/lib/database/rls";
import { applySecurity, composeSecurity, hasAccess, protectTable } from "#layers/core/server/lib/database/security";
import { asUser, closeDb, createTestDb, insertUsers, isSuperuser } from "#layers/core/tests/unit/helpers/db";

let db: Kysely<Database>;

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
const carolGroup = crypto.randomUUID();
const daveGroup = crypto.randomUUID();

beforeAll(async () => {
  db = await createTestDb();

  await insertUsers(db, { alice, bob });

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

describe("row level security", () => {
  it("runs as a role without superuser rights", async () => {
    expect(await isSuperuser(db)).toBe(true);
    const role = await asUser({ id: alice, permissions: ["user:read:own"] }, async (trx) => {
      const r = await sql<{ roleName: string }>`SELECT CURRENT_USER AS role_name`.execute(trx);
      return r.rows[0]?.roleName;
    });
    expect(role).toBe(FALLBACK_ROLE);
  });

  it("disables JIT compilation in the transactions of users", async () => {
    const jit = await asUser({ id: alice }, async (trx) => {
      const r = await sql<{ jit: string }>`SHOW jit`.execute(trx);
      return r.rows[0]?.jit;
    });
    expect(jit).toBe("off");
  });

  it.each<{ principal: string; as: TestPrincipal; users: string[]; groups: string[] }>([
    {
      principal: "a member",
      as: { id: alice, permissions: ["user:read:own", "group:read:own"] },
      users: ["alice"],
      groups: ["carol-group"],
    },
    {
      principal: "a principal with the all scope",
      as: { id: alice, permissions: ["user:read:all", "group:read:all"] },
      users: ["alice", "bob"],
      groups: ["carol-group", "dave-group"],
    },
    { principal: "a principal without permissions", as: { id: alice }, users: [], groups: [] },
  ])("lets $principal read the users and groups that it can access", async ({ as, users, groups }) => {
    const visible = await asUser(as, async (trx) => {
      return {
        users: (await trx.selectFrom("users").select(["username"]).orderBy("username").execute()).map(
          (u) => u.username,
        ),
        groups: (await trx.selectFrom("groups").select(["name"]).orderBy("name").execute()).map((g) => g.name),
      };
    });
    expect(visible).toEqual({ users, groups });
  });

  it("rejects writes without the matching permission", async () => {
    await expect(
      asUser({ id: alice, permissions: ["user:read:own"] }, (trx) => {
        return trx.insertInto("groups").values({ name: "forbidden-group", description: "" }).execute();
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects a member assigning roles to themselves", async () => {
    const role = await db
      .insertInto("roles")
      .values({ name: "test-admin" })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    await expect(
      asUser({ id: alice, permissions: ["user:read:own", "user:update:own"] }, (trx) => {
        return trx.insertInto("userRoles").values({ userId: alice, roleId: role.id }).execute();
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("knows no shared resource without other features", async () => {
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

  it("rejects policies that look up the session for each row", () => {
    const feature = (using: string): ServerFeature => ({
      name: "extra",
      security: { statements: () => [`CREATE POLICY extra_objects_select ON public.extra_objects USING (${using})`] },
    });
    expect(() => composeSecurity([coreFeature, feature("user_id = security.user_id()")])).toThrow(
      /Policy "extra_objects_select" must call security\.user_id\(\) in a subquery/,
    );
    expect(() => composeSecurity([coreFeature, feature("security.can_any(ARRAY['user:read:all'])")])).toThrow(
      /must call security\.can_any\(\) in a subquery/,
    );
    expect(() => composeSecurity([coreFeature, feature("user_id = (SELECT security.user_id())")])).not.toThrow();
  });

  it("requires the access checks of a policy to qualify their column", () => {
    const resource = defineSharedResource({ type: "extra_object", table: "extra_objects" });
    expect(() => hasAccess(resource, "id")).toThrow(/must be qualified with its table/);
    expect(hasAccess(resource, "extra_objects.id")).toContain("acl.extra_object_id = extra_objects.id");
  });

  it("rejects a fallback role that bypasses row level security", async () => {
    await sql`ALTER ROLE ${sql.raw(FALLBACK_ROLE)} BYPASSRLS`.execute(db);
    try {
      await expect(applySecurity(db, [coreFeature])).rejects.toThrow(/bypasses row level security/);
    } finally {
      await sql`ALTER ROLE ${sql.raw(FALLBACK_ROLE)} NOBYPASSRLS`.execute(db);
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
