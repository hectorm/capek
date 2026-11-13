import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import coreFeature from "#layers/core/server/feature";
import { coreSeed } from "#layers/core/server/seed";
import { closeDb, createTestDb, runSeed } from "#layers/core/tests/unit/helpers/db";

let db: Kysely<Database>;

beforeAll(async () => {
  db = await createTestDb();
  await db
    .insertInto("roles")
    .values([{ name: "admin" }, { name: "member" }])
    .execute();
});

afterAll(async () => {
  await closeDb();
});

describe("core seed", () => {
  it("creates the users and groups with their roles once", async () => {
    const config = {
      users: [
        { username: "alice", fullname: "Alice", email: "Alice@Example.com", roles: ["admin"], groups: ["sales"] },
      ],
      groups: [{ name: "sales", roles: ["member"] }],
    };
    await runSeed(db, [coreFeature], coreSeed, config);
    await runSeed(db, [coreFeature], coreSeed, config);

    const users = await db
      .selectFrom("users")
      .leftJoin("userRoles", "userRoles.userId", "users.id")
      .leftJoin("roles", "roles.id", "userRoles.roleId")
      .select(["users.username", "users.email", "roles.name as role"])
      .execute();
    expect(users).toEqual([{ username: "alice", email: "alice@example.com", role: "admin" }]);

    const groups = await db
      .selectFrom("groups")
      .innerJoin("groupRoles", "groupRoles.groupId", "groups.id")
      .innerJoin("roles", "roles.id", "groupRoles.roleId")
      .innerJoin("userGroups", "userGroups.groupId", "groups.id")
      .innerJoin("users", "users.id", "userGroups.userId")
      .select(["groups.name", "roles.name as role", "users.username as member"])
      .execute();
    expect(groups).toEqual([{ name: "sales", role: "member", member: "alice" }]);
  });
});
