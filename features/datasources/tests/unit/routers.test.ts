import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ResourceName } from "#layers/core/server/lib/authz/resources";
import type { PermissionName, RoleName } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import { listResources } from "#layers/core/server/lib/authz/resources";
import { createTRPCRouter } from "#layers/core/server/trpc/init";
import { HTTP_REDACTED_VALUE } from "#layers/core/shared/http";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";
import { asUser, closeDb, createTestCaller, createTestDb, insertUsers } from "#layers/core/tests/unit/helpers/db";
import datasourcesFeature from "#layers/datasources/server/feature";
import { SourceResource } from "#layers/datasources/server/lib/resources";
import { decryptSourceConfig, encryptSourceConfig } from "#layers/datasources/server/lib/secrets";
import { sourceRouter } from "#layers/datasources/server/trpc/routers/source";
import { DatasourcesPermissions, DatasourcesRolePermissions } from "#layers/datasources/shared/rbac";

let db: Kysely<Database>;

const mallory = crypto.randomUUID();
const alice = crypto.randomUUID();
const sourceId = crypto.randomUUID();
const privateSourceId = crypto.randomUUID();

const config = { connectionString: "postgres://127.0.0.1:1/sales", authType: "none" };
const storedConfig = { ...config, authType: "basic", username: "postgres", password: "hunter2" };

const router = createTRPCRouter({ source: sourceRouter });
const rolePermissions = (role: RoleName): PermissionName[] => {
  return [...CoreRolePermissions[role], ...DatasourcesRolePermissions[role]];
};
const member = createTestCaller(router, { id: mallory, permissions: rolePermissions(Roles.Member) });
const editor = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Member) });
const creator = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Creator) });

beforeAll(async () => {
  db = await createTestDb([datasourcesFeature]);

  await insertUsers(db, { mallory, alice });
  await db
    .insertInto("datasourcesSources")
    .values([
      {
        id: sourceId,
        name: "sales",
        description: "Sales data",
        documentation: "One row per sale",
        type: "postgres",
        config: encryptSourceConfig(storedConfig),
      },
      {
        id: privateSourceId,
        name: "private",
        description: "",
        documentation: null,
        type: "postgres",
        config: encryptSourceConfig(storedConfig),
      },
    ])
    .execute();
  await db
    .insertInto("datasourcesSourceAccess")
    .values([
      { sourceId, userId: mallory, role: "user" },
      { sourceId, userId: alice, role: "editor" },
    ])
    .execute();
});

afterAll(async () => {
  await closeDb();
});

describe("connection test", () => {
  it("is not run for users who can neither create nor update the resource", async () => {
    await expect(member.source.testConnection({ type: "postgres", config })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(member.source.testConnection({ id: sourceId, type: "postgres", config })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("datasource", () => {
  const access = [
    { id: alice, type: "user" as const, role: "editor" as const },
    { id: mallory, type: "user" as const, role: "user" as const },
  ];

  afterEach(async () => {
    await db.deleteFrom("datasourcesSources").where("id", "not in", [sourceId, privateSourceId]).execute();
  });

  it("is only visible to the users that it is shared with", async () => {
    const visible = (granted: PermissionName[]): Promise<string[]> => {
      return asUser({ id: mallory, permissions: granted }, async (trx) => {
        const rows = await trx.selectFrom("datasourcesSources").select(["name"]).orderBy("name").execute();
        return rows.map((row) => row.name);
      });
    };

    const { SourceReadOwn, SourceListOwn, SourceListAll } = DatasourcesPermissions;
    expect(await visible([SourceReadOwn, SourceListOwn])).toEqual(["sales"]);
    expect(await visible([SourceListAll])).toEqual(["private", "sales"]);
    expect(await visible([])).toEqual([]);
  });

  it("is assignable by the users that can read it", async () => {
    const assignable = (granted: PermissionName[]): Promise<ResourceName[]> => {
      return asUser({ id: mallory, permissions: granted }, (trx) => {
        return listResources(trx, SourceResource, { limit: 10 });
      });
    };
    const { SourceReadOwn, SourceUseOwn } = DatasourcesPermissions;
    expect(await assignable([SourceReadOwn, SourceUseOwn])).toEqual([{ id: sourceId, name: "sales" }]);
    expect(await assignable([SourceReadOwn])).toEqual([{ id: sourceId, name: "sales" }]);
    expect(await assignable([SourceUseOwn])).toEqual([{ id: sourceId, name: "sales" }]);
    expect(await assignable([])).toEqual([]);
  });

  it("is read without its password", async () => {
    const source = await member.source.read({ id: sourceId });
    expect(source.config).toMatchObject({ username: "postgres", password: HTTP_REDACTED_VALUE });
  });

  it("enforces list and read scopes separately for direct and group grants", async () => {
    const { SourceListAll, SourceListOwn, SourceReadAll, SourceReadOwn, SourceUpdateAll, SourceDeleteAll } =
      DatasourcesPermissions;

    const browser = createTestCaller(router, {
      id: mallory,
      permissions: [SourceListAll, SourceReadOwn, SourceUpdateAll, SourceDeleteAll],
    }).source;
    const page = await browser.search({ limit: 1 });
    expect(page.sources).toMatchObject([{ id: privateSourceId, canRead: false }]);
    expect(page.nextCursor).toBeDefined();
    expect((await browser.search({ limit: 1, cursor: page.nextCursor })).sources).toMatchObject([
      { id: sourceId, canRead: true },
    ]);
    await expect(browser.read({ id: privateSourceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(browser.readMetadata({ id: privateSourceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(browser.listAccess({ sourceId: privateSourceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(browser.readMetadata({ id: sourceId })).resolves.toMatchObject({
      id: sourceId,
      canEdit: true,
      canDelete: true,
    });

    const reader = createTestCaller(router, { id: mallory, permissions: [SourceListOwn, SourceReadAll] }).source;
    const listed = await reader.search({ limit: 1 });
    expect(listed.sources).toMatchObject([{ id: sourceId, canRead: true }]);
    expect(listed.nextCursor).toBeUndefined();
    await expect(reader.readMetadata({ id: privateSourceId })).resolves.toMatchObject({ id: privateSourceId });

    const group = crypto.randomUUID();
    await db.insertInto("groups").values({ id: group, name: "catalog", description: "" }).execute();
    await db
      .insertInto("datasourcesSourceAccess")
      .values({ sourceId: privateSourceId, groupId: group, role: "user" })
      .execute();
    const listOnly = createTestCaller(router, { id: mallory, groups: [group], permissions: [SourceListOwn] }).source;
    expect((await listOnly.search({})).sources).toMatchObject([
      { id: privateSourceId, canRead: false },
      { id: sourceId, canRead: false },
    ]);
    const grants = await asUser({ id: mallory, groups: [group], permissions: [SourceListOwn] }, (trx) => {
      return trx.selectFrom("datasourcesSourceAccess").select(["userId", "groupId"]).execute();
    });
    expect(grants).toHaveLength(2);
    expect(grants).toEqual(
      expect.arrayContaining([
        { userId: mallory, groupId: null },
        { userId: null, groupId: group },
      ]),
    );
  });

  it("is read with the caller's allowed actions in its metadata", async () => {
    await expect(member.source.readMetadata({ id: sourceId })).resolves.toEqual({
      id: sourceId,
      name: "sales",
      description: "Sales data",
      documentation: "One row per sale",
      type: "postgres",
      canEdit: false,
      canDelete: false,
    });
    await expect(editor.source.readMetadata({ id: sourceId })).resolves.toMatchObject({
      canEdit: true,
      canDelete: true,
    });
    await expect(member.source.readMetadata({ id: privateSourceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is created, updated and deleted only by the users allowed to", async () => {
    const input = { name: "created", type: "postgres", config, access };

    await expect(member.source.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id } = await creator.source.create(input);

    const update = { id, name: "renamed", type: "postgres", config };
    await expect(member.source.update(update)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(creator.source.update(update)).resolves.toMatchObject({ name: "renamed" });

    await expect(member.source.delete({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await creator.source.delete({ id });
    await expect(creator.source.read({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is saved with its access, or not at all", async () => {
    const { id } = await creator.source.create({ name: "shared", type: "postgres", config, access });
    const saved = await db
      .selectFrom("datasourcesSourceAccess")
      .select(["userId", "role"])
      .where("sourceId", "=", id)
      .orderBy("role")
      .execute();
    expect(saved).toEqual([
      { userId: alice, role: "editor" },
      { userId: mallory, role: "user" },
    ]);
    await expect(member.source.listAccess({ sourceId: id })).resolves.toEqual([
      { id: mallory, type: "user", role: "user", username: "mallory", email: "mallory@example.com" },
    ]);

    const missing = [{ id: crypto.randomUUID(), type: "user" as const, role: "user" as const }];
    await expect(creator.source.create({ name: "unsaved", type: "postgres", config, access: missing })).rejects.toThrow(
      "One or more users or groups do not exist",
    );
    expect(await db.selectFrom("datasourcesSources").select(["id"]).where("name", "=", "unsaved").execute()).toEqual(
      [],
    );

    await expect(
      creator.source.update({ id, name: "unsaved", type: "postgres", config, access: missing }),
    ).rejects.toThrow("One or more users or groups do not exist");
    const source = await db.selectFrom("datasourcesSources").select(["name"]).where("id", "=", id).executeTakeFirst();
    expect(source).toEqual({ name: "shared" });
  });

  it("keeps its stored password only while its type stays the same", async () => {
    const { id } = await creator.source.create({ name: "typed", type: "postgres", config: storedConfig });
    const redacted = { ...storedConfig, password: HTTP_REDACTED_VALUE };
    const storedPassword = async (): Promise<unknown> => {
      const source = await db
        .selectFrom("datasourcesSources")
        .select(["config"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      return decryptSourceConfig(source.config).password;
    };

    await creator.source.update({ id, type: "postgres", config: redacted });
    expect(await storedPassword()).toBe("hunter2");

    await creator.source.update({ id, type: "mariadb", config: redacted });
    expect(await storedPassword()).toBe("");
  });
});
