import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { SettingKey } from "#layers/core/server/lib/settings/define";
import type { RoleName } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import { createCallerFactory, createTRPCRouter } from "#layers/core/server/trpc/init";
import { groupRouter } from "#layers/core/server/trpc/routers/group";
import { roleRouter } from "#layers/core/server/trpc/routers/role";
import { settingsRouter } from "#layers/core/server/trpc/routers/settings";
import { userRouter } from "#layers/core/server/trpc/routers/user";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";
import { closeDb, createTestDb, insertUsers } from "#layers/core/tests/unit/helpers/db";

vi.mock("#layers/core/server/lib/features", async () => {
  const { z } = await import("zod/v4");
  const { SettingType } = await import("#layers/core/shared/settings");
  return {
    getServerFeatures: () => [
      {
        name: "test",
        settings: {
          "test.name": {
            type: SettingType.String,
            category: "test",
            isPublic: true,
            getDefault: () => "",
            schema: z.string().max(100),
            config: { inputType: "text", minLength: 0, maxLength: 100 },
          },
          "test.internal": {
            type: SettingType.String,
            category: "test",
            isPublic: false,
            getDefault: () => "",
            schema: z.string().max(100),
            config: { inputType: "text", minLength: 0, maxLength: 100 },
          },
        },
      },
    ],
  };
});

let db: Kysely<Database>;

const alice = crypto.randomUUID();
const audrey = crypto.randomUUID();
const carl = crypto.randomUUID();
const mallory = crypto.randomUUID();
const bob = crypto.randomUUID();
const staff = crypto.randomUUID();
const board = crypto.randomUUID();

const NAME_KEY = "test.name" as SettingKey;

const router = createTRPCRouter({ user: userRouter, group: groupRouter, role: roleRouter, settings: settingsRouter });
const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined } as unknown as Logger;
const caller = createCallerFactory(router);

const callerOf = (username: string, id: string, role: RoleName, groups: string[] = []): ReturnType<typeof caller> => {
  const user: AuthUser = {
    id,
    username,
    fullname: username,
    email: `${username}@example.com`,
    picture: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    groups,
    permissions: [...CoreRolePermissions[role]],
  };
  return caller({ logger, user });
};

const admin = callerOf("alice", alice, Roles.Admin);
const auditor = callerOf("audrey", audrey, Roles.Auditor);
const creator = callerOf("carl", carl, Roles.Creator);
const member = callerOf("mallory", mallory, Roles.Member, [staff]);
const anonymous = caller({ logger, user: null });

beforeAll(async () => {
  db = await createTestDb();

  await insertUsers(db, { alice, audrey, carl, mallory, bob });
  await db.insertInto("roles").values({ name: "admin" }).execute();
  const memberRole = await db
    .insertInto("roles")
    .values({ name: "member" })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  await db
    .insertInto("groups")
    .values([
      { id: staff, name: "staff", description: "Staff" },
      { id: board, name: "board", description: "" },
    ])
    .execute();
  await db.insertInto("userGroups").values({ userId: mallory, groupId: staff }).execute();
  await db.insertInto("groupRoles").values({ groupId: staff, roleId: memberRole.id }).execute();
});

afterAll(async () => {
  await closeDb();
});

describe("user", () => {
  it("is read by the roles with the all scope, and by itself for members", async () => {
    for (const reader of [admin, auditor, creator]) {
      await expect(reader.user.read({ id: bob })).resolves.toMatchObject({ id: bob, username: "bob" });
    }

    await expect(member.user.read({ id: mallory })).resolves.toEqual({
      id: mallory,
      username: "mallory",
      fullname: "mallory",
      email: "mallory@example.com",
      groups: ["staff"],
      roles: [],
    });
    await expect(member.user.read({ id: bob })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is searched only by the roles that list every user", async () => {
    for (const reader of [admin, auditor, creator]) {
      const { users } = await reader.user.search({ search: ["bob", "mallory"] });
      expect(users.map((user) => user.username)).toEqual(["bob", "mallory"]);

      const byGroup = await reader.user.search({ search: "staff", searchBy: "groups" });
      expect(byGroup.users.map((user) => user.username)).toEqual(["mallory"]);
    }

    await expect(member.user.search({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is created, updated and deleted only by admins", async () => {
    const input = {
      username: "newcomer",
      fullname: "New Comer",
      email: "Newcomer@Example.com",
      roles: ["member"],
      groups: ["staff"],
    };
    for (const writer of [auditor, creator, member]) {
      await expect(writer.user.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const created = await admin.user.create(input);
    expect(created).toMatchObject({
      username: "newcomer",
      email: "newcomer@example.com",
      roles: ["member"],
      groups: ["staff"],
    });
    await expect(admin.user.create(input)).rejects.toMatchObject({ code: "CONFLICT" });

    for (const writer of [auditor, creator, member]) {
      await expect(writer.user.update({ id: created.id, fullname: "Renamed" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    await expect(
      admin.user.update({ id: created.id, fullname: "Renamed", roles: [], groups: ["board"] }),
    ).resolves.toMatchObject({ fullname: "Renamed", roles: [], groups: ["board"] });

    for (const writer of [auditor, creator, member]) {
      await expect(writer.user.delete({ id: created.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await admin.user.delete({ id: created.id });
    await expect(admin.user.read({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(admin.user.delete({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not let admins delete their own account", async () => {
    await expect(admin.user.delete({ id: alice })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.user.read({ id: alice })).resolves.toMatchObject({ id: alice });
  });

  it("is read by itself without a permission, and is empty without a session", async () => {
    await expect(member.user.readOwn()).resolves.toEqual({
      id: mallory,
      username: "mallory",
      fullname: "mallory",
      email: "mallory@example.com",
      picture: null,
      groups: [staff],
      permissions: [...CoreRolePermissions[Roles.Member]],
      canLogOut: false,
    });
    await expect(anonymous.user.readOwn()).resolves.toBeNull();
  });
});

describe("group", () => {
  it("is read by the roles with the all scope, and by its members", async () => {
    for (const reader of [admin, auditor, creator]) {
      await expect(reader.group.read({ id: board })).resolves.toMatchObject({ id: board, name: "board" });
    }

    await expect(member.group.read({ id: staff })).resolves.toEqual({
      id: staff,
      name: "staff",
      description: "Staff",
      roles: ["member"],
    });
    await expect(member.group.read({ id: board })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is searched among every group, or among the groups of a member", async () => {
    for (const reader of [admin, auditor, creator]) {
      const { groups } = await reader.group.search({ search: ["staff", "board"] });
      expect(groups.map((group) => group.name)).toEqual(["board", "staff"]);
    }

    const own = await member.group.search({});
    expect(own.groups.map((group) => group.name)).toEqual(["staff"]);
    await expect(anonymous.group.search({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("is created, updated and deleted only by admins", async () => {
    const input = { name: "auditors", description: "Audit", roles: ["member"] };
    for (const writer of [auditor, creator, member]) {
      await expect(writer.group.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const created = await admin.group.create(input);
    expect(created).toMatchObject({ name: "auditors", description: "Audit", roles: ["member"] });
    await expect(admin.group.create(input)).rejects.toMatchObject({ code: "CONFLICT" });

    for (const writer of [auditor, creator, member]) {
      await expect(writer.group.update({ id: created.id, name: "reviewers" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    await expect(admin.group.update({ id: created.id, name: "reviewers", roles: [] })).resolves.toMatchObject({
      name: "reviewers",
      roles: [],
    });

    for (const writer of [auditor, creator, member]) {
      await expect(writer.group.delete({ id: created.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await admin.group.delete({ id: created.id });
    await expect(admin.group.read({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(admin.group.delete({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("role", () => {
  it("is listed for every user with a session", async () => {
    for (const reader of [admin, auditor, creator, member]) {
      const roles = await reader.role.list();
      expect(roles.map((role) => role.name)).toEqual(["admin", "member"]);
    }

    await expect(anonymous.role.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("settings", () => {
  it("are listed in full for the roles with the all scope, and only the public ones for the others", async () => {
    for (const reader of [admin, auditor]) {
      expect(Object.keys(await reader.settings.list())).toEqual(["test.name", "test.internal"]);
    }
    for (const reader of [creator, member]) {
      expect(Object.keys(await reader.settings.list())).toEqual(["test.name"]);
    }

    await expect(anonymous.settings.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("are updated and reset only by admins", async () => {
    const update = { settings: [{ key: NAME_KEY, value: "Acme" }] };
    for (const writer of [auditor, creator, member]) {
      await expect(writer.settings.update(update)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }

    await admin.settings.update(update);
    expect((await member.settings.list())[NAME_KEY]).toMatchObject({ value: "Acme", isOverridden: true });

    await admin.settings.update({ settings: [{ key: NAME_KEY, value: null }] });
    expect((await member.settings.list())[NAME_KEY]).toMatchObject({ value: "", isOverridden: false });
  });

  it("rejects unknown settings and invalid values", async () => {
    await expect(admin.settings.update({ settings: [{ key: "test.unknown", value: "Acme" }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      admin.settings.update({ settings: [{ key: NAME_KEY, value: "x".repeat(101) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
