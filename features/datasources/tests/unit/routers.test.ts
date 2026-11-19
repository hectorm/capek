import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import { listResources } from "#layers/core/server/lib/authz/resources";
import { createCallerFactory, createTRPCRouter } from "#layers/core/server/trpc/init";
import { HTTP_REDACTED_VALUE } from "#layers/core/shared/http";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";
import { asUser, closeDb, createTestDb, insertUsers } from "#layers/core/tests/unit/helpers/db";
import datasourcesFeature from "#layers/datasources/server/feature";
import { SourceResource } from "#layers/datasources/server/lib/resources";
import { encryptSourceConfig } from "#layers/datasources/server/lib/secrets";
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
const logger = { warn: () => undefined, debug: () => undefined } as unknown as Logger;
const permissions = [...CoreRolePermissions[Roles.Member], ...DatasourcesRolePermissions[Roles.Member]];
const caller = createCallerFactory(router);
const asMember = (id: string) => caller({ logger, user: { id, groups: [], permissions } as unknown as AuthUser });
const member = asMember(mallory);
const editor = asMember(alice);

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
  it("is only visible to the users that it is shared with", async () => {
    const visible = (granted: string[]): Promise<string[]> => {
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

  it("is only assignable by the users that can use it", async () => {
    const assignable = (granted: string[]) => {
      return asUser({ id: mallory, permissions: granted }, (trx) => {
        return listResources(trx, SourceResource, { limit: 10 });
      });
    };
    const { SourceReadOwn, SourceUseOwn } = DatasourcesPermissions;
    expect(await assignable([SourceReadOwn, SourceUseOwn])).toEqual([{ id: sourceId, name: "sales" }]);
    // The use permission is enough
    expect(await assignable([SourceUseOwn])).toEqual([{ id: sourceId, name: "sales" }]);
  });

  it("is read without its password", async () => {
    const source = await member.source.read({ id: sourceId });
    expect(source.config).toMatchObject({ username: "postgres", password: HTTP_REDACTED_VALUE });
  });

  it("enforces list and read scopes separately for direct and group grants", async () => {
    const { SourceListAll, SourceListOwn, SourceReadAll, SourceReadOwn, SourceUpdateAll, SourceDeleteAll } =
      DatasourcesPermissions;
    const asCaller = (granted: string[], groups: string[] = []) => {
      return caller({ logger, user: { id: mallory, groups, permissions: granted } as AuthUser });
    };

    const browser = asCaller([SourceListAll, SourceReadOwn, SourceUpdateAll, SourceDeleteAll]).source;
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

    const reader = asCaller([SourceListOwn, SourceReadAll]).source;
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
    const listOnly = asCaller([SourceListOwn], [group]).source;
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
});
