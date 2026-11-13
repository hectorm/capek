import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import { Sessions } from "#layers/core/server/lib/authn/sessions";
import { getUserAuthContext } from "#layers/core/server/lib/authn/strategies";
import { getOrCreateUserFromOIDC } from "#layers/core/server/lib/authn/sync";
import { closeDb, createTestDb, insertUsers } from "#layers/core/tests/unit/helpers/db";

let db: Kysely<Database>;

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();

beforeAll(async () => {
  db = await createTestDb();

  await insertUsers(db, { alice, bob });
});

afterAll(async () => {
  await closeDb();
});

describe("session", () => {
  it("is extended while used up to its maximum lifetime", async () => {
    const sessions = new Sessions({ cookieName: "session", durationSec: 60, maxDurationSec: 100 });
    const { token } = await sessions.createSession(alice);

    const age = async (createdAgoSec: number, expiresInSec: number): Promise<void> => {
      const createdAt = new Date(Date.now() - createdAgoSec * 1000);
      const expiresAt = new Date(Date.now() + expiresInSec * 1000);
      await sql`UPDATE sessions SET created_at = ${createdAt}, expires_at = ${expiresAt}`.execute(db);
    };

    await age(10, 20);
    const extended = await sessions.validateSession(token);
    expect(extended.fresh).toBe(true);
    expect(extended.session?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

    await age(90, 5);
    const limited = await sessions.validateSession(token);
    expect(limited.fresh).toBe(true);
    expect(limited.session?.expiresAt.getTime()).toBe(Number(limited.session?.createdAt.getTime()) + 100_000);
    expect(await sessions.validateSession(token)).toMatchObject({ session: { userId: alice }, fresh: false });

    await age(100, 0);
    expect(await sessions.validateSession(token)).toEqual({ session: null, fresh: false });
  });
});

describe("auth context", () => {
  it("combines the permissions of the roles of the user and of its groups", async () => {
    const insertRole = async (name: string, permission: string): Promise<string> => {
      const { id: permissionId } = await db
        .insertInto("permissions")
        .values({ name: permission })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      const { id: roleId } = await db.insertInto("roles").values({ name }).returning(["id"]).executeTakeFirstOrThrow();
      await db.insertInto("rolePermissions").values({ roleId, permissionId }).execute();
      return roleId;
    };
    const reader = await insertRole("reader", "test:read");
    const writer = await insertRole("writer", "test:write");
    await insertRole("remover", "test:delete");
    const group = await db
      .insertInto("groups")
      .values({ name: "writers", description: "" })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await db.insertInto("userRoles").values({ userId: alice, roleId: reader }).execute();
    await db.insertInto("userGroups").values({ userId: alice, groupId: group.id }).execute();
    await db.insertInto("groupRoles").values({ groupId: group.id, roleId: writer }).execute();

    const context = await getUserAuthContext(alice);
    expect(context.groups).toEqual([group.id]);
    expect(context.permissions.toSorted()).toEqual(["test:read", "test:write"]);
  });
});

describe("OIDC account linking", () => {
  it("links an identity to the user with its email only when verified", async () => {
    const identity = { iss: "https://idp.localhost", fullname: "Bob", email: "bob@example.com" };

    await expect(
      getOrCreateUserFromOIDC({ ...identity, sub: "mallory", username: "mallory", emailVerified: false }),
    ).rejects.toThrow(/duplicate key/);

    const user = await getOrCreateUserFromOIDC({ ...identity, sub: "bob", username: "bob", emailVerified: true });
    expect(user.id).toBe(bob);
  });
});
