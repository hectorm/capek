import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import { createCallerFactory, createTRPCRouter } from "#layers/core/server/trpc/init";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";
import { closeDb, createTestDb } from "#layers/core/tests/unit/helpers/db";
import datasourcesFeature from "#layers/datasources/server/feature";
import { sourceRouter } from "#layers/datasources/server/trpc/routers/source";
import { DatasourcesRolePermissions } from "#layers/datasources/shared/rbac";

let db: Kysely<Database>;

const mallory = crypto.randomUUID();
const sourceId = crypto.randomUUID();

const config = { connectionString: "postgres://127.0.0.1:1/sales", authType: "none" };

const router = createTRPCRouter({ source: sourceRouter });
const logger = { warn: () => undefined } as unknown as Logger;
const permissions = [...CoreRolePermissions[Roles.Member], ...DatasourcesRolePermissions[Roles.Member]];
const member = createCallerFactory(router)({ logger, user: { id: mallory, groups: [], permissions } });

beforeAll(async () => {
  db = await createTestDb([datasourcesFeature]);

  await db
    .insertInto("users")
    .values({ id: mallory, username: "mallory", fullname: "Mallory", email: "mallory@example.com" })
    .execute();
  await db
    .insertInto("datasourcesSources")
    .values({
      id: sourceId,
      name: "sales",
      description: "",
      documentation: null,
      type: "postgres",
      config: JSON.stringify(config),
    })
    .execute();
  await db.insertInto("datasourcesSourceAccess").values({ sourceId, userId: mallory, role: "user" }).execute();
});

afterAll(async () => {
  await closeDb();
});

describe("connection tests", () => {
  it("are not run for those who can neither create nor update what they test", async () => {
    await expect(member.source.testConnection({ type: "postgres", config })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(member.source.testConnection({ id: sourceId, type: "postgres", config })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
