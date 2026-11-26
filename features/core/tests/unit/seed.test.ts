import { setTimeout } from "node:timers/promises";

import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SeedDefinition } from "#layers/core/server/lib/seed";
import type { Database } from "#layers/core/shared/schema";
import coreFeature from "#layers/core/server/feature";
import { defineSeed } from "#layers/core/server/lib/seed";
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
  it("releases prepared resources after a deferred failure rolls back the transaction", async () => {
    const steps: string[] = [];
    const seed = defineSeed({
      schema: {},
      async prepare(_config, { db: database, deferCleanup }) {
        expect(await database.selectFrom("groups").select("id").where("name", "=", "prepared").execute()).toEqual([]);
        steps.push("prepare");
        deferCleanup(() => {
          steps.push("release");
        });
        return "prepared";
      },
      async run(_config, ctx, prepared) {
        steps.push(`apply ${prepared}`);
        await ctx.db.insertInto("groups").values({ name: "prepared", description: "" }).execute();
        ctx.defer(() => Promise.reject(new Error("Deferred failure")));
      },
    });
    await expect(runSeed(db, [coreFeature], seed, {})).rejects.toThrow("Deferred failure");
    expect(steps).toEqual(["prepare", "apply prepared", "release"]);
    expect(await db.selectFrom("groups").select("id").where("name", "=", "prepared").execute()).toEqual([]);
  });

  it("runs the seeds of concurrent instances one after the other", async () => {
    const steps: string[] = [];
    const seedOf = (name: string): SeedDefinition => {
      return defineSeed({
        schema: {},
        async prepare() {
          steps.push(`${name} prepare`);
          await setTimeout(20);
        },
        run() {
          steps.push(`${name} run`);
          return Promise.resolve();
        },
      });
    };
    await Promise.all([runSeed(db, [coreFeature], seedOf("a"), {}), runSeed(db, [coreFeature], seedOf("b"), {})]);
    const first = steps[0]?.startsWith("a") ? "a" : "b";
    const second = first === "a" ? "b" : "a";
    expect(steps).toEqual([`${first} prepare`, `${first} run`, `${second} prepare`, `${second} run`]);
  });

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
