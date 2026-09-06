import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "~~/shared/schema";
import { asUser, closeDb, createTestDb, insertAgent, isSuperuser } from "~~/tests/unit/helpers/db";

let db: Kysely<Database>;

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
const carolGroup = crypto.randomUUID();

let ownedAgentId: string;
let sharedAgentId: string;
let groupAgentId: string;
let orphanAgentId: string;

beforeAll(async () => {
  db = await createTestDb();

  await db
    .insertInto("users")
    .values([
      { id: alice, username: "alice", fullname: "Alice", email: "alice@example.com" },
      { id: bob, username: "bob", fullname: "Bob", email: "bob@example.com" },
    ])
    .execute();

  await db.insertInto("groups").values({ id: carolGroup, name: "carol-group", description: "" }).execute();

  ownedAgentId = await insertAgent(db, "owned-agent");
  sharedAgentId = await insertAgent(db, "shared-agent");
  groupAgentId = await insertAgent(db, "group-agent");
  orphanAgentId = await insertAgent(db, "orphan-agent");

  await db
    .insertInto("agentAccess")
    .values([
      { agentId: ownedAgentId, userId: alice, role: "editor" },
      { agentId: sharedAgentId, userId: alice, role: "user" },
      { agentId: groupAgentId, groupId: carolGroup, role: "user" },
    ])
    .execute();
});

afterAll(async () => {
  await closeDb();
});

const visibleAgentIds = (principal: { id: string; groups?: string[]; permissions?: string[] }): Promise<string[]> => {
  return asUser(principal, async (trx) => {
    const rows = await trx.selectFrom("agents").select(["id"]).execute();
    return rows.map((r) => r.id);
  });
};

describe("rls agent visibility", () => {
  it("uses a non-superuser role so RLS actually applies", async () => {
    expect(await isSuperuser(db)).toBe(true);
    const role = await asUser({ id: alice, permissions: ["chat:read:own"] }, async (trx) => {
      const { sql } = await import("kysely");
      const r = await sql<{ roleName: string }>`SELECT CURRENT_USER AS role_name`.execute(trx);
      return r.rows[0]?.roleName;
    });
    expect(role).toBe("capek");
  });

  it("hides agents a member neither owns nor was granted", async () => {
    const ids = await visibleAgentIds({ id: bob, permissions: ["agent:read:own", "agent:list:own"] });
    expect(ids).not.toContain(ownedAgentId);
    expect(ids).not.toContain(sharedAgentId);
    expect(ids).not.toContain(groupAgentId);
    expect(ids).not.toContain(orphanAgentId);
    expect(ids).toHaveLength(0);
  });

  it("shows an editor their granted agent under the own scope", async () => {
    const ids = await visibleAgentIds({ id: alice, permissions: ["agent:read:own", "agent:list:own"] });
    expect(ids).toContain(ownedAgentId);
    expect(ids).toContain(sharedAgentId);
    expect(ids).not.toContain(groupAgentId);
    expect(ids).not.toContain(orphanAgentId);
  });

  it("propagates access through group membership", async () => {
    const withGroup = await visibleAgentIds({
      id: bob,
      groups: [carolGroup],
      permissions: ["agent:read:own", "agent:list:own"],
    });
    expect(withGroup).toContain(groupAgentId);

    const withoutGroup = await visibleAgentIds({ id: bob, permissions: ["agent:read:own", "agent:list:own"] });
    expect(withoutGroup).not.toContain(groupAgentId);
  });

  it("shows every agent to a principal with the all scope", async () => {
    const ids = await visibleAgentIds({ id: bob, permissions: ["agent:read:all", "agent:list:all"] });
    expect(ids).toContain(ownedAgentId);
    expect(ids).toContain(sharedAgentId);
    expect(ids).toContain(groupAgentId);
    expect(ids).toContain(orphanAgentId);
  });

  it("hides everything from a principal with no agent permissions", async () => {
    const ids = await visibleAgentIds({ id: bob, permissions: ["chat:read:own"] });
    expect(ids).toHaveLength(0);
  });
});
