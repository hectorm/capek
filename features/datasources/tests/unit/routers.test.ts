import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import { createCallerFactory, createTRPCRouter } from "#layers/core/server/trpc/init";
import { HttpRedactedValue } from "#layers/core/shared/http";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";
import { closeDb, createTestDb, insertUsers } from "#layers/core/tests/unit/helpers/db";
import datasourcesFeature from "#layers/datasources/server/feature";
import { sourceRouter } from "#layers/datasources/server/trpc/routers/source";
import { DatasourcesRolePermissions } from "#layers/datasources/shared/rbac";

let db: Kysely<Database>;

const mallory = crypto.randomUUID();
const sourceId = crypto.randomUUID();

const config = { connectionString: "postgres://127.0.0.1:1/sales", authType: "none" };
const storedConfig = { ...config, authType: "basic", username: "postgres", password: "hunter2" };

const router = createTRPCRouter({ source: sourceRouter });
const logger = { warn: () => undefined, debug: () => undefined } as unknown as Logger;
const permissions = [...CoreRolePermissions[Roles.Member], ...DatasourcesRolePermissions[Roles.Member]];
const user = { id: mallory, groups: [], permissions } as unknown as AuthUser;
const member = createCallerFactory(router)({ logger, user });

beforeAll(async () => {
  db = await createTestDb([datasourcesFeature]);

  await insertUsers(db, { mallory });
  await db
    .insertInto("datasourcesSources")
    .values({
      id: sourceId,
      name: "sales",
      description: "",
      documentation: null,
      type: "postgres",
      config: JSON.stringify(storedConfig),
    })
    .execute();
  await db.insertInto("datasourcesSourceAccess").values({ sourceId, userId: mallory, role: "user" }).execute();
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
  it("is read without its password", async () => {
    const source = await member.source.read({ id: sourceId });
    expect(source.config).toMatchObject({ username: "postgres", password: HttpRedactedValue });
  });
});
