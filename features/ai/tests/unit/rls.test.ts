import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import aiFeature from "#layers/ai/server/feature";
import { AgentResource, LlmProviderResource, McpServerResource, SkillResource } from "#layers/ai/server/lib/resources";
import { AiRolePermissions } from "#layers/ai/shared/rbac";
import { asUser, closeDb, createAiTestDb, insertAgent, insertSkill } from "#layers/ai/tests/unit/helpers/db";
import coreFeature from "#layers/core/server/feature";
import { syncResourceAccess } from "#layers/core/server/lib/authz/resources";
import { composeSecurity } from "#layers/core/server/lib/database/security";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";

let db: Kysely<Database>;

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
const carolGroup = crypto.randomUUID();

let ownedAgentId: string;
let sharedAgentId: string;
let groupAgentId: string;
let orphanAgentId: string;

beforeAll(async () => {
  db = await createAiTestDb();

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
    .insertInto("aiAgentAccess")
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
    const rows = await trx.selectFrom("aiAgents").select(["id"]).execute();
    return rows.map((r) => r.id);
  });
};

describe("rls agent visibility", () => {
  it("hides agents a member neither owns nor was granted", async () => {
    const ids = await visibleAgentIds({ id: bob, permissions: ["ai_agent:read:own", "ai_agent:list:own"] });
    expect(ids).not.toContain(ownedAgentId);
    expect(ids).not.toContain(sharedAgentId);
    expect(ids).not.toContain(groupAgentId);
    expect(ids).not.toContain(orphanAgentId);
    expect(ids).toHaveLength(0);
  });

  it("shows an editor their granted agent under the own scope", async () => {
    const ids = await visibleAgentIds({ id: alice, permissions: ["ai_agent:read:own", "ai_agent:list:own"] });
    expect(ids).toContain(ownedAgentId);
    expect(ids).toContain(sharedAgentId);
    expect(ids).not.toContain(groupAgentId);
    expect(ids).not.toContain(orphanAgentId);
  });

  it("propagates access through group membership", async () => {
    const withGroup = await visibleAgentIds({
      id: bob,
      groups: [carolGroup],
      permissions: ["ai_agent:read:own", "ai_agent:list:own"],
    });
    expect(withGroup).toContain(groupAgentId);

    const withoutGroup = await visibleAgentIds({ id: bob, permissions: ["ai_agent:read:own", "ai_agent:list:own"] });
    expect(withoutGroup).not.toContain(groupAgentId);
  });

  it("shows every agent to a principal with the all scope", async () => {
    const ids = await visibleAgentIds({ id: bob, permissions: ["ai_agent:read:all", "ai_agent:list:all"] });
    expect(ids).toContain(ownedAgentId);
    expect(ids).toContain(sharedAgentId);
    expect(ids).toContain(groupAgentId);
    expect(ids).toContain(orphanAgentId);
  });

  it("hides everything from a principal with no agent permissions", async () => {
    const ids = await visibleAgentIds({ id: bob, permissions: ["ai_chat:read:own"] });
    expect(ids).toHaveLength(0);
  });
});

describe("rls shared resource principals", () => {
  const memberPermissions = [...CoreRolePermissions[Roles.Member], ...AiRolePermissions[Roles.Member]];

  const visibleUserIds = (principal: { id: string; permissions: string[] }): Promise<string[]> => {
    return asUser(principal, async (trx) => {
      const rows = await trx.selectFrom("users").select(["id"]).execute();
      return rows.map((r) => r.id);
    });
  };

  const visibleGroupIds = (principal: { id: string; permissions: string[] }): Promise<string[]> => {
    return asUser(principal, async (trx) => {
      const rows = await trx.selectFrom("groups").select(["id"]).execute();
      return rows.map((r) => r.id);
    });
  };

  it("covers every shared resource type in the visibility of users and groups", () => {
    const statements = composeSecurity([coreFeature, aiFeature]);
    for (const policy of ["users_select", "groups_select"]) {
      const statement = statements.find((s) => s.includes(`CREATE POLICY ${policy} `)) ?? "";
      for (const resource of [AgentResource, LlmProviderResource, McpServerResource, SkillResource]) {
        expect(statement).toContain(`public.${resource.accessTable} `);
      }
    }
  });

  it("lets editors see the principals a resource is shared with", async () => {
    const dave = crypto.randomUUID();
    const erin = crypto.randomUUID();
    const frankGroup = crypto.randomUUID();

    await db
      .insertInto("users")
      .values([
        { id: dave, username: "dave", fullname: "Dave", email: "dave@example.com" },
        { id: erin, username: "erin", fullname: "Erin", email: "erin@example.com" },
      ])
      .execute();
    await db.insertInto("groups").values({ id: frankGroup, name: "frank-group", description: "" }).execute();

    expect(await visibleUserIds({ id: dave, permissions: memberPermissions })).toEqual([dave]);
    expect(await visibleGroupIds({ id: dave, permissions: memberPermissions })).toEqual([]);

    const skillId = await insertSkill(db, "shared-skill");
    await db
      .insertInto("aiSkillAccess")
      .values([
        { skillId, userId: dave, role: "editor" },
        { skillId, userId: erin, role: "user" },
        { skillId, groupId: frankGroup, role: "user" },
      ])
      .execute();

    expect((await visibleUserIds({ id: dave, permissions: memberPermissions })).toSorted()).toEqual(
      [dave, erin].toSorted(),
    );
    expect(await visibleGroupIds({ id: dave, permissions: memberPermissions })).toEqual([frankGroup]);

    // Users of a resource do not see the other principals, only its editors do
    expect(await visibleUserIds({ id: erin, permissions: memberPermissions })).toEqual([erin]);
  });
});

describe("rls shared resource access sync", () => {
  const memberPermissions = [...CoreRolePermissions[Roles.Member], ...AiRolePermissions[Roles.Member]];

  it("lets an editor move their editor access to a group they belong to", async () => {
    const skillId = await insertSkill(db, "sync-skill");
    await db.insertInto("aiSkillAccess").values({ skillId, userId: alice, role: "editor" }).execute();

    const principal = { id: alice, groups: [carolGroup], permissions: memberPermissions };
    await asUser(principal, (trx) =>
      syncResourceAccess(trx, SkillResource, skillId, [
        { id: carolGroup, type: "group", role: "editor" },
        { id: alice, type: "user", role: "user" },
      ]),
    );

    const rows = await db
      .selectFrom("aiSkillAccess")
      .select(["userId", "groupId", "role"])
      .where("skillId", "=", skillId)
      .execute();
    expect(rows).toEqual(
      expect.arrayContaining([
        { userId: null, groupId: carolGroup, role: "editor" },
        { userId: alice, groupId: null, role: "user" },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("rejects removing access entries without being an editor", async () => {
    const skillId = await insertSkill(db, "readonly-skill");
    await db
      .insertInto("aiSkillAccess")
      .values([
        { skillId, userId: alice, role: "user" },
        { skillId, userId: bob, role: "editor" },
      ])
      .execute();

    const principal = { id: alice, permissions: ["ai_skill:read:own", "ai_skill:update:own"] };
    await expect(asUser(principal, (trx) => syncResourceAccess(trx, SkillResource, skillId, []))).rejects.toThrow(
      /could not be revoked/,
    );

    const rows = await db.selectFrom("aiSkillAccess").select(["userId"]).where("skillId", "=", skillId).execute();
    expect(rows).toHaveLength(2);
  });
});
