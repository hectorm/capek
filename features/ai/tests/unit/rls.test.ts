import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import type { TestPrincipal } from "#layers/core/tests/unit/helpers/db";
import aiFeature from "#layers/ai/server/feature";
import { AgentResource, LlmProviderResource, McpServerResource, SkillResource } from "#layers/ai/server/lib/resources";
import { AiRolePermissions } from "#layers/ai/shared/rbac";
import {
  asUser,
  closeDb,
  createAiTestDb,
  insertAgent,
  insertLlmProvider,
  insertSkill,
  insertUsers,
} from "#layers/ai/tests/unit/helpers/db";
import coreFeature from "#layers/core/server/feature";
import { grantResourceAccess, syncResourceAccess } from "#layers/core/server/lib/authz/resources";
import { composeSecurity } from "#layers/core/server/lib/database/security";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";

let db: Kysely<Database>;

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
const carolGroup = crypto.randomUUID();

let groupAgentId: string;
let orphanAgentId: string;

beforeAll(async () => {
  db = await createAiTestDb();

  await insertUsers(db, { alice, bob });
  await db.insertInto("groups").values({ id: carolGroup, name: "carol-group", description: "" }).execute();

  const ownedAgentId = await insertAgent(db, "owned-agent");
  const sharedAgentId = await insertAgent(db, "shared-agent");
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

const own = ["ai_agent:read:own", "ai_agent:list:own"];
const all = ["ai_agent:read:all", "ai_agent:list:all"];

describe("agent visibility", () => {
  it.each<{ principal: string; as: TestPrincipal; agents: string[] }>([
    { principal: "a member without access", as: { id: bob, permissions: own }, agents: [] },
    { principal: "an editor or user", as: { id: alice, permissions: own }, agents: ["owned-agent", "shared-agent"] },
    { principal: "a group member", as: { id: bob, groups: [carolGroup], permissions: own }, agents: ["group-agent"] },
    {
      principal: "a principal with the all scope",
      as: { id: bob, permissions: all },
      agents: ["group-agent", "orphan-agent", "owned-agent", "shared-agent"],
    },
    {
      principal: "a principal without agent permissions",
      as: { id: bob, permissions: ["ai_chat:read:own"] },
      agents: [],
    },
  ])("lets $principal read the agents that it can access", async ({ as, agents }) => {
    const visible = await asUser(as, (trx) => trx.selectFrom("aiAgents").select(["name"]).orderBy("name").execute());
    expect(visible.map((agent) => agent.name)).toEqual(agents);
  });
});

describe("principal visibility", () => {
  const memberPermissions = [...CoreRolePermissions[Roles.Member], ...AiRolePermissions[Roles.Member]];

  const visibleUserIds = (principal: TestPrincipal): Promise<string[]> => {
    return asUser(principal, async (trx) => {
      const rows = await trx.selectFrom("users").select(["id"]).execute();
      return rows.map((r) => r.id);
    });
  };

  const visibleGroupIds = (principal: TestPrincipal): Promise<string[]> => {
    return asUser(principal, async (trx) => {
      const rows = await trx.selectFrom("groups").select(["id"]).execute();
      return rows.map((r) => r.id);
    });
  };

  it("covers every shared resource type", () => {
    const statements = composeSecurity([coreFeature, aiFeature]);
    for (const policy of ["users_select", "groups_select"]) {
      const statement = statements.find((s) => s.includes(`CREATE POLICY ${policy} `)) ?? "";
      for (const resource of [AgentResource, LlmProviderResource, McpServerResource, SkillResource]) {
        expect(statement).toContain(`public.${resource.accessTable} `);
      }
    }
  });

  it("shows editors the principals that a resource is shared with", async () => {
    const dave = crypto.randomUUID();
    const erin = crypto.randomUUID();
    const frankGroup = crypto.randomUUID();

    await insertUsers(db, { dave, erin });
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

describe("resource access sync", () => {
  const memberPermissions = [...CoreRolePermissions[Roles.Member], ...AiRolePermissions[Roles.Member]];

  it("lets an editor move their editor access to a group they belong to", async () => {
    const skillId = await insertSkill(db, "sync-skill");
    await db.insertInto("aiSkillAccess").values({ skillId, userId: alice, role: "editor" }).execute();

    const principal = { id: alice, groups: [carolGroup], permissions: memberPermissions };
    await asUser(principal, (trx) => {
      return syncResourceAccess(trx, SkillResource, skillId, [
        { id: carolGroup, type: "group", role: "editor" },
        { id: alice, type: "user", role: "user" },
      ]);
    });

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

  it("rejects removing access without being an editor", async () => {
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

describe("resource secret", () => {
  it("is only locked for update by an editor", async () => {
    const grace = crypto.randomUUID();
    const permissions = ["ai_llm_provider:create", "ai_llm_provider:update:own", "ai_llm_provider:use:own"];

    await insertUsers(db, { grace });
    const llmProviderId = await insertLlmProvider(db, "locked-provider");
    await db.insertInto("aiLlmProviderAccess").values({ llmProviderId, userId: grace, role: "user" }).execute();

    // The connection test takes the secrets hidden in the form with this lock
    const lockedApiKey = (): Promise<string | undefined> => {
      return asUser({ id: grace, permissions }, async (trx) => {
        const row = await trx
          .selectFrom("aiLlmProviders")
          .select(["apiKey"])
          .where("id", "=", llmProviderId)
          .forUpdate()
          .executeTakeFirst();
        return row?.apiKey;
      });
    };

    expect(await lockedApiKey()).toBeUndefined();

    await db.insertInto("aiLlmProviderAccess").values({ llmProviderId, userId: grace, role: "editor" }).execute();

    expect(await lockedApiKey()).toBe("hunter2");
  });
});

describe("resource creation", () => {
  const creatorPermissions = [...CoreRolePermissions[Roles.Creator], ...AiRolePermissions[Roles.Creator]];
  const ownAccess = [
    { id: alice, type: "user", role: "editor" },
    { id: alice, type: "user", role: "user" },
  ] as const;

  it("lets creators grant themselves access to what they create", async () => {
    const skillId = crypto.randomUUID();
    const created = await asUser({ id: alice, permissions: creatorPermissions }, async (trx) => {
      // Reading before writing is what the transaction has no ID for yet
      await trx.selectFrom("aiSkills").select(["id"]).execute();
      await trx.insertInto("aiSkills").values({ id: skillId, name: "created-skill", description: "" }).execute();
      await grantResourceAccess(trx, SkillResource, skillId, ownAccess);
      return trx.selectFrom("aiSkills").select(["id", "name"]).where("id", "=", skillId).executeTakeFirst();
    });
    expect(created).toEqual({ id: skillId, name: "created-skill" });

    const rows = await db.selectFrom("aiSkillAccess").select(["role"]).where("skillId", "=", skillId).execute();
    expect(rows.map((row) => row.role).toSorted()).toEqual(["editor", "user"]);
  });

  it("rejects creators granting themselves access to the resources of others", async () => {
    const skillId = await insertSkill(db, "existing-skill");
    await expect(
      asUser({ id: alice, permissions: creatorPermissions }, (trx) => {
        return grantResourceAccess(trx, SkillResource, skillId, ownAccess);
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects creators granting access to others", async () => {
    const skillId = crypto.randomUUID();
    await expect(
      asUser({ id: alice, permissions: ["ai_skill:create"] }, async (trx) => {
        await trx.insertInto("aiSkills").values({ id: skillId, name: "given-skill", description: "" }).execute();
        await grantResourceAccess(trx, SkillResource, skillId, [{ id: bob, type: "user", role: "editor" }]);
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("chat ownership", () => {
  const permissions = [...AiRolePermissions[Roles.Member]];
  let sessionId: string;

  beforeAll(async () => {
    const session = await db
      .insertInto("aiChatSessions")
      .values({ userId: alice, agentId: null, title: "private" })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    sessionId = session.id;
    await db.insertInto("aiChatMessages").values({ sessionId, role: "user", content: "secret" }).execute();
  });

  const visibleMessages = (userId: string): Promise<string[]> => {
    return asUser({ id: userId, permissions }, async (trx) => {
      const rows = await trx
        .selectFrom("aiChatMessages")
        .select(["content"])
        .where("sessionId", "=", sessionId)
        .execute();
      return rows.map((row) => row.content);
    });
  };

  it("only shows the messages of a chat to its owner", async () => {
    expect(await visibleMessages(alice)).toEqual(["secret"]);
    expect(await visibleMessages(bob)).toEqual([]);
  });

  it("only lets the owner of a chat write messages in it", async () => {
    const write = (userId: string) => {
      return asUser({ id: userId, permissions }, (trx) => {
        return trx.insertInto("aiChatMessages").values({ sessionId, role: "user", content: "more" }).execute();
      });
    };
    await expect(write(bob)).rejects.toThrow(/row-level security/);
    await expect(write(alice)).resolves.toBeDefined();
  });

  it("lets the owner keep an agent that they can no longer choose", async () => {
    const chat = await db
      .insertInto("aiChatSessions")
      .values({ userId: alice, agentId: orphanAgentId, title: "unshared" })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    const update = (values: { title?: string; agentId?: string }) => {
      return asUser({ id: alice, permissions }, (trx) => {
        return trx.updateTable("aiChatSessions").set(values).where("id", "=", chat.id).returning(["id"]).execute();
      });
    };

    await expect(update({ title: "renamed" })).resolves.toHaveLength(1);
    await expect(update({ agentId: groupAgentId })).rejects.toThrow(/row-level security/);
  });

  it("rejects messages with the roles of the server", async () => {
    await expect(
      asUser({ id: alice, permissions }, (trx) => {
        return trx.insertInto("aiChatMessages").values({ sessionId, role: "assistant", content: "forged" }).execute();
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("only shows the tables of a chat to its owner", async () => {
    await db
      .insertInto("aiChatTables")
      .values({ sessionId, data: Buffer.from(""), size: 0 })
      .execute();

    const visibleTables = (userId: string) => {
      return asUser({ id: userId, permissions }, (trx) => trx.selectFrom("aiChatTables").select(["id"]).execute());
    };
    expect(await visibleTables(alice)).toHaveLength(1);
    expect(await visibleTables(bob)).toHaveLength(0);
  });

  it("rejects tables written by users", async () => {
    const table = { sessionId, data: Buffer.from(""), size: 0 };
    await expect(
      asUser({ id: alice, permissions }, (trx) => trx.insertInto("aiChatTables").values(table).execute()),
    ).rejects.toThrow(/row-level security/);
  });
});
