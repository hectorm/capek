import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { Database } from "#layers/core/shared/schema";
import type { TestPrincipal } from "#layers/core/tests/unit/helpers/db";
import coreFeature from "#layers/core/server/feature";
import { defineSharedResource } from "#layers/core/server/lib/authz/resources";
import { migrateToLatest } from "#layers/core/server/lib/database/migrator";
import { FALLBACK_ROLE } from "#layers/core/server/lib/database/rls";
import { applySecurity, composeSecurity, hasAccess, protectTable } from "#layers/core/server/lib/database/security";
import { createCallerFactory, createTRPCRouter } from "#layers/core/server/trpc/init";
import { groupRouter } from "#layers/core/server/trpc/routers/group";
import { userRouter } from "#layers/core/server/trpc/routers/user";
import { CorePermissions, CoreRolePermissions, Roles } from "#layers/core/shared/rbac";
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

describe("row-level security", () => {
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

  it("scopes directory reads and group search to the permission for that action", async () => {
    const { GroupListAll, GroupListOwn, GroupReadAll, GroupReadOwn, UserListAll, UserReadOwn } = CorePermissions;
    const caller = createCallerFactory(createTRPCRouter({ user: userRouter, group: groupRouter }));
    const logger = { warn: () => undefined, debug: () => undefined } as unknown as Logger;
    const asAlice = (permissions: string[]): ReturnType<typeof caller> => {
      return caller({ logger, user: { id: alice, groups: [carolGroup], permissions } as unknown as AuthUser });
    };

    const browse = asAlice([UserListAll, UserReadOwn, GroupListAll, GroupReadOwn]);
    await expect(browse.user.read({ id: alice })).resolves.toMatchObject({ id: alice });
    await expect(browse.user.read({ id: bob })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(browse.group.read({ id: carolGroup })).resolves.toMatchObject({ id: carolGroup });
    await expect(browse.group.read({ id: daveGroup })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const read = asAlice([GroupReadAll, GroupListOwn]);
    await expect(read.group.read({ id: daveGroup })).resolves.toMatchObject({ id: daveGroup });
    await expect(read.group.search({ limit: 1 })).resolves.toMatchObject({
      groups: [{ id: carolGroup }],
      nextCursor: undefined,
    });
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

  it("rejects tables without row-level security", async () => {
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

  it("rejects a fallback role that bypasses row-level security", async () => {
    await sql`ALTER ROLE ${sql.raw(FALLBACK_ROLE)} BYPASSRLS`.execute(db);
    try {
      await expect(applySecurity(db, [coreFeature])).rejects.toThrow(/bypasses row-level security/);
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

// Updates and deletes skip the rows that their policies hide, so the tests below count the rows that they change
describe("users policies", () => {
  it("lets the holders of user:create insert users", async () => {
    const insert = (permissions: string[]): Promise<unknown> => {
      return asUser({ id: alice, permissions }, (trx) => {
        return trx
          .insertInto("users")
          .values({ username: "erin", fullname: "erin", email: "erin@example.com" })
          .execute();
      });
    };

    await expect(insert(["user:read:all", "user:update:all"])).rejects.toThrow(/row-level security/);
    await expect(insert(["user:create"])).resolves.toBeDefined();
  });

  it("lets users update themselves with user:update:own and any user with user:update:all", async () => {
    const update = (permissions: string[], id: string): Promise<bigint> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const result = await trx
          .updateTable("users")
          .set({ updatedAt: new Date() })
          .where("id", "=", id)
          .executeTakeFirst();
        return result.numUpdatedRows;
      });
    };

    expect(await update(["user:read:all", "user:update:own"], bob)).toBe(0n);
    expect(await update(["user:read:own", "user:update:own"], alice)).toBe(1n);
    expect(await update(["user:read:all", "user:update:all"], bob)).toBe(1n);
  });

  it("lets the holders of user:delete:all delete users", async () => {
    const frank = crypto.randomUUID();
    await insertUsers(db, { frank });
    const remove = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const result = await trx.deleteFrom("users").where("id", "=", frank).executeTakeFirst();
        return result.numDeletedRows;
      });
    };

    expect(await remove(["user:read:all", "user:update:all"])).toBe(0n);
    expect(await remove(["user:read:all", "user:delete:all"])).toBe(1n);
  });
});

describe("groups policies", () => {
  it("lets the holders of group:create insert groups", async () => {
    const insert = (permissions: string[]): Promise<unknown> => {
      return asUser({ id: alice, permissions }, (trx) => {
        return trx.insertInto("groups").values({ name: "erin-group", description: "" }).execute();
      });
    };

    await expect(insert(["group:read:all", "group:update:all"])).rejects.toThrow(/row-level security/);
    await expect(insert(["group:create"])).resolves.toBeDefined();
  });

  it("lets the holders of group:update:all update groups", async () => {
    const update = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const result = await trx
          .updateTable("groups")
          .set({ updatedAt: new Date() })
          .where("id", "=", daveGroup)
          .executeTakeFirst();
        return result.numUpdatedRows;
      });
    };

    expect(await update(["group:read:all", "group:create"])).toBe(0n);
    expect(await update(["group:read:all", "group:update:all"])).toBe(1n);
  });

  it("lets the holders of group:delete:all delete groups", async () => {
    const group = crypto.randomUUID();
    await db.insertInto("groups").values({ id: group, name: "frank-group", description: "" }).execute();
    const remove = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const result = await trx.deleteFrom("groups").where("id", "=", group).executeTakeFirst();
        return result.numDeletedRows;
      });
    };

    expect(await remove(["group:read:all", "group:update:all"])).toBe(0n);
    expect(await remove(["group:read:all", "group:delete:all"])).toBe(1n);
  });
});

describe("roles and permissions policies", () => {
  it("lets every user read the roles, the permissions and their links, but not write them", async () => {
    const role = await db
      .insertInto("roles")
      .values({ name: "rls-reader" })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    const permission = await db
      .insertInto("permissions")
      .values({ name: "rls:read" })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    await db.insertInto("rolePermissions").values({ roleId: role.id, permissionId: permission.id }).execute();

    const visible = await asUser({ id: alice }, async (trx) => {
      return {
        roles: await trx.selectFrom("roles").select(["id"]).where("id", "=", role.id).execute(),
        permissions: await trx.selectFrom("permissions").select(["id"]).where("id", "=", permission.id).execute(),
        links: await trx.selectFrom("rolePermissions").select(["roleId"]).where("roleId", "=", role.id).execute(),
      };
    });
    expect(visible).toEqual({
      roles: [{ id: role.id }],
      permissions: [{ id: permission.id }],
      links: [{ roleId: role.id }],
    });

    const everything = { id: alice, permissions: [...CoreRolePermissions[Roles.Admin]] };
    await expect(
      asUser(everything, (trx) => trx.insertInto("roles").values({ name: "rls-writer" }).execute()),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(everything, (trx) => trx.insertInto("permissions").values({ name: "rls:write" }).execute()),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(everything, (trx) => trx.deleteFrom("rolePermissions").where("roleId", "=", role.id).execute()),
    ).resolves.toEqual([expect.objectContaining({ numDeletedRows: 0n })]);
  });
});

describe("user groups policies", () => {
  beforeAll(async () => {
    await db.insertInto("userGroups").values({ userId: bob, groupId: daveGroup }).execute();
  });

  it("lets users read their own memberships and the holders of the all scopes read every membership", async () => {
    const memberships = (permissions: string[]): Promise<string[]> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const rows = await trx
          .selectFrom("userGroups")
          .select(["groupId"])
          .where("userId", "in", [alice, bob])
          .execute();
        return rows.map((row) => row.groupId).toSorted();
      });
    };

    expect(await memberships([])).toEqual([carolGroup]);
    expect(await memberships(["group:list:all"])).toEqual([carolGroup, daveGroup].toSorted());
  });

  it("lets the holders of user:update:all add users to groups", async () => {
    const insert = (permissions: string[]): Promise<unknown> => {
      return asUser({ id: alice, permissions }, (trx) => {
        return trx.insertInto("userGroups").values({ userId: bob, groupId: carolGroup }).execute();
      });
    };

    await expect(insert(["user:update:own", "group:update:all"])).rejects.toThrow(/row-level security/);
    await expect(insert(["user:update:all"])).resolves.toBeDefined();
  });

  it("lets the holders of user:update:all remove users from groups", async () => {
    const remove = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const result = await trx
          .deleteFrom("userGroups")
          .where("userId", "=", bob)
          .where("groupId", "=", daveGroup)
          .executeTakeFirst();
        return result.numDeletedRows;
      });
    };

    expect(await remove(["user:read:all", "group:update:all"])).toBe(0n);
    expect(await remove(["user:read:all", "user:update:all"])).toBe(1n);
  });
});

describe("user roles policies", () => {
  let role: string;

  beforeAll(async () => {
    ({ id: role } = await db
      .insertInto("roles")
      .values({ name: "rls-user" })
      .returning(["id"])
      .executeTakeFirstOrThrow());
    await db
      .insertInto("userRoles")
      .values([
        { userId: alice, roleId: role },
        { userId: bob, roleId: role },
      ])
      .execute();
  });

  it("lets users read their own roles and the holders of the all scopes read the roles of every user", async () => {
    const assigned = (permissions: string[]): Promise<string[]> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const rows = await trx.selectFrom("userRoles").select(["userId"]).where("roleId", "=", role).execute();
        return rows.map((row) => row.userId).toSorted();
      });
    };

    expect(await assigned(["group:read:all"])).toEqual([alice]);
    expect(await assigned(["user:list:all"])).toEqual([alice, bob].toSorted());
  });

  it("lets the holders of user:update:all assign roles", async () => {
    const other = await db
      .insertInto("roles")
      .values({ name: "rls-other" })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    const insert = (permissions: string[]): Promise<unknown> => {
      return asUser({ id: alice, permissions }, (trx) => {
        return trx.insertInto("userRoles").values({ userId: bob, roleId: other.id }).execute();
      });
    };

    await expect(insert(["user:update:own", "group:update:all"])).rejects.toThrow(/row-level security/);
    await expect(insert(["user:update:all"])).resolves.toBeDefined();
  });

  it("lets the holders of user:update:all remove roles", async () => {
    const remove = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const result = await trx
          .deleteFrom("userRoles")
          .where("userId", "=", bob)
          .where("roleId", "=", role)
          .executeTakeFirst();
        return result.numDeletedRows;
      });
    };

    expect(await remove(["user:read:all", "group:update:all"])).toBe(0n);
    expect(await remove(["user:read:all", "user:update:all"])).toBe(1n);
  });
});

describe("group roles policies", () => {
  let role: string;

  beforeAll(async () => {
    ({ id: role } = await db
      .insertInto("roles")
      .values({ name: "rls-group" })
      .returning(["id"])
      .executeTakeFirstOrThrow());
    await db
      .insertInto("groupRoles")
      .values([
        { groupId: carolGroup, roleId: role },
        { groupId: daveGroup, roleId: role },
      ])
      .execute();
  });

  it("lets members read the roles of their groups and the holders of the all scopes read every group", async () => {
    const assigned = (permissions: string[]): Promise<string[]> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const rows = await trx.selectFrom("groupRoles").select(["groupId"]).where("roleId", "=", role).execute();
        return rows.map((row) => row.groupId).toSorted();
      });
    };

    expect(await assigned(["user:read:all"])).toEqual([]);
    expect(await assigned(["group:read:own"])).toEqual([carolGroup]);
    expect(await assigned(["group:list:all"])).toEqual([carolGroup, daveGroup].toSorted());
  });

  it("lets the holders of group:update:all assign roles to groups", async () => {
    const other = await db
      .insertInto("roles")
      .values({ name: "rls-group-other" })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    const insert = (permissions: string[]): Promise<unknown> => {
      return asUser({ id: alice, permissions }, (trx) => {
        return trx.insertInto("groupRoles").values({ groupId: daveGroup, roleId: other.id }).execute();
      });
    };

    await expect(insert(["group:read:all", "user:update:all"])).rejects.toThrow(/row-level security/);
    await expect(insert(["group:update:all"])).resolves.toBeDefined();
  });

  it("lets the holders of group:update:all remove roles from groups", async () => {
    const remove = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const result = await trx
          .deleteFrom("groupRoles")
          .where("groupId", "=", daveGroup)
          .where("roleId", "=", role)
          .executeTakeFirst();
        return result.numDeletedRows;
      });
    };

    expect(await remove(["group:read:all", "user:update:all"])).toBe(0n);
    expect(await remove(["group:read:all", "group:update:all"])).toBe(1n);
  });
});

describe("settings policies", () => {
  beforeAll(async () => {
    await db
      .insertInto("settings")
      .values([
        { key: "rls.updated", value: JSON.stringify("Acme") },
        { key: "rls.deleted", value: JSON.stringify("Acme") },
      ])
      .execute();
  });

  it("lets the holders of any settings scope read the settings", async () => {
    const keys = (permissions: string[]): Promise<string[]> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const rows = await trx.selectFrom("settings").select(["key"]).where("key", "=", "rls.updated").execute();
        return rows.map((row) => row.key);
      });
    };

    expect(await keys(["user:read:all", "settings:create"])).toEqual([]);
    expect(await keys(["settings:list:public"])).toEqual(["rls.updated"]);
  });

  it("lets the holders of settings:create insert settings", async () => {
    const insert = (permissions: string[]): Promise<unknown> => {
      return asUser({ id: alice, permissions }, (trx) => {
        return trx
          .insertInto("settings")
          .values({ key: "rls.inserted", value: JSON.stringify("Acme") })
          .execute();
      });
    };

    await expect(insert(["settings:update:all"])).rejects.toThrow(/row-level security/);
    await expect(insert(["settings:create"])).resolves.toBeDefined();
  });

  it("lets the holders of settings:update:all update settings", async () => {
    const update = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const result = await trx
          .updateTable("settings")
          .set({ updatedAt: new Date() })
          .where("key", "=", "rls.updated")
          .executeTakeFirst();
        return result.numUpdatedRows;
      });
    };

    expect(await update(["settings:read:all", "settings:create"])).toBe(0n);
    expect(await update(["settings:read:all", "settings:update:all"])).toBe(1n);
  });

  it("lets the holders of settings:delete:all delete settings", async () => {
    const remove = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: alice, permissions }, async (trx) => {
        const result = await trx.deleteFrom("settings").where("key", "=", "rls.deleted").executeTakeFirst();
        return result.numDeletedRows;
      });
    };

    expect(await remove(["settings:read:all", "settings:update:all"])).toBe(0n);
    expect(await remove(["settings:read:all", "settings:delete:all"])).toBe(1n);
  });
});
