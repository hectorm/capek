import type { InsertResult, Kysely, RawBuilder, Transaction } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { UserTransactionOptions } from "#layers/core/server/lib/database";
import type { ResourceSelectAction } from "#layers/core/server/lib/database/security";
import type { Database } from "#layers/core/shared/schema";
import type { TestPrincipal } from "#layers/core/tests/unit/helpers/db";
import aiFeature from "#layers/ai/server/feature";
import {
  AgentResource,
  ChatResource,
  LlmProviderResource,
  McpServerResource,
  SkillResource,
} from "#layers/ai/server/lib/resources";
import { decryptLlmProviderSecrets } from "#layers/ai/server/lib/secrets";
import { AiRolePermissions } from "#layers/ai/shared/rbac";
import {
  asUser,
  closeDb,
  createAiTestDb,
  insertAgent,
  insertLlmProvider,
  insertMcpServer,
  insertSkill,
  insertUsers,
} from "#layers/ai/tests/unit/helpers/db";
import coreFeature from "#layers/core/server/feature";
import { grantResourceAccess, syncResourceAccess } from "#layers/core/server/lib/authz/resources";
import { withUserTransaction } from "#layers/core/server/lib/database";
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

// Runs as the principal with what the server adds to a transaction, such as trusted writes or the scope of a resource
const asUserWith = <T>(
  principal: TestPrincipal,
  options: UserTransactionOptions,
  callback: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> => {
  const user = { id: principal.id, groups: principal.groups ?? [], permissions: principal.permissions ?? [] };
  return withUserTransaction(user as unknown as AuthUser, callback, options);
};

const matching = (filter: Record<string, string>): RawBuilder<unknown> => {
  const conditions = Object.entries(filter).map(([column, value]) => sql`${sql.ref(column)} = ${value}`);
  return sql.join([sql`TRUE`, ...conditions], sql` AND `);
};

// The policies of the tables are checked with plain SQL, so the same cases apply to every table of a kind
const countRows = async (
  trx: Kysely<Database>,
  table: string,
  filter: Record<string, string> = {},
): Promise<number> => {
  const result = await sql<{ count: number }>`
    SELECT count(*)::INTEGER AS count FROM ${sql.table(table)} WHERE ${matching(filter)}
  `.execute(trx);
  return result.rows[0]?.count ?? 0;
};

const insertRow = async (trx: Kysely<Database>, table: string, values: Record<string, unknown>): Promise<void> => {
  await sql`
    INSERT INTO ${sql.table(table)} (${sql.join(Object.keys(values).map((column) => sql.ref(column)))})
    VALUES (${sql.join(Object.values(values))})
  `.execute(trx);
};

const updateRows = async (
  trx: Kysely<Database>,
  table: string,
  values: Record<string, unknown>,
  filter: Record<string, string>,
): Promise<bigint> => {
  const assignments = sql.join(Object.entries(values).map(([column, value]) => sql`${sql.ref(column)} = ${value}`));
  const result = await sql`UPDATE ${sql.table(table)} SET ${assignments} WHERE ${matching(filter)}`.execute(trx);
  return result.numAffectedRows ?? 0n;
};

const deleteRows = async (trx: Kysely<Database>, table: string, filter: Record<string, string>): Promise<bigint> => {
  const result = await sql`DELETE FROM ${sql.table(table)} WHERE ${matching(filter)}`.execute(trx);
  return result.numAffectedRows ?? 0n;
};

const insertSession = async (userId: string, agentId: string | null = null): Promise<string> => {
  const session = await db
    .insertInto("aiChatSessions")
    .values({ userId, agentId, title: "" })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return session.id;
};

const insertMessage = async (sessionId: string, role: "user" | "assistant", content = ""): Promise<string> => {
  const message = await db
    .insertInto("aiChatMessages")
    .values({ sessionId, role, content })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return message.id;
};

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
          .select(["apiKey", "headers"])
          .where("id", "=", llmProviderId)
          .forUpdate()
          .executeTakeFirst();
        return row ? decryptLlmProviderSecrets(row).apiKey : undefined;
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
    const write = (userId: string): Promise<InsertResult[]> => {
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
    const update = (values: { title?: string; agentId?: string }): Promise<{ id: string }[]> => {
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

    const visibleTables = (userId: string): Promise<{ id: string }[]> => {
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

describe("chat policies", () => {
  const heidi = crypto.randomUUID();
  const ivan = crypto.randomUUID();
  const member = [...AiRolePermissions[Roles.Member]];
  const reader = ["ai_chat:read:own"];
  let sessionId: string;
  let userMessageId: string;
  let assistantMessageId: string;

  beforeAll(async () => {
    await insertUsers(db, { heidi, ivan });
    sessionId = await insertSession(heidi);
    userMessageId = await insertMessage(sessionId, "user", "question");
    assistantMessageId = await insertMessage(sessionId, "assistant", "answer");
    await db
      .insertInto("aiChatTables")
      .values({ sessionId, data: Buffer.from(""), size: 0 })
      .execute();
  });

  it("only shows a chat to its owner", async () => {
    const visibleSessions = (userId: string): Promise<number> => {
      return asUser({ id: userId, permissions: reader }, (trx) => {
        return countRows(trx, "ai_chat_sessions", { id: sessionId });
      });
    };
    await expect(visibleSessions(heidi)).resolves.toBe(1);
    await expect(visibleSessions(ivan)).resolves.toBe(0);
  });

  it.each([
    { table: "ai_chat_sessions", column: "id" },
    { table: "ai_chat_messages", column: "session_id" },
    { table: "ai_chat_tables", column: "session_id" },
  ])("keeps $table out of the lists of a user who can only read chats", async ({ table, column }) => {
    const visibleRows = (action: ResourceSelectAction): Promise<number> => {
      return asUserWith(
        { id: heidi, permissions: reader },
        { resourceScope: `${ChatResource.type}:${action}` },
        (trx) => {
          return countRows(trx, table, { [column]: sessionId });
        },
      );
    };
    await expect(visibleRows("read")).resolves.toBeGreaterThan(0);
    await expect(visibleRows("list")).resolves.toBe(0);
  });

  it("only lets users start chats of their own with the agents that they can use", async () => {
    const start = (userId: string, agentId: string | null): Promise<InsertResult[]> => {
      return asUser({ id: heidi, permissions: member }, (trx) => {
        return trx.insertInto("aiChatSessions").values({ userId, agentId, title: "" }).execute();
      });
    };
    await expect(start(heidi, null)).resolves.toBeDefined();
    await expect(start(ivan, null)).rejects.toThrow(/row-level security/);
    await expect(start(heidi, orphanAgentId)).rejects.toThrow(/row-level security/);
  });

  it("only lets the owner of a chat delete it with the permission to", async () => {
    const chatId = await insertSession(heidi);
    const remove = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: heidi, permissions }, (trx) => deleteRows(trx, "ai_chat_sessions", { id: chatId }));
    };
    await expect(remove(reader)).resolves.toBe(0n);
    await expect(remove([...reader, "ai_chat:delete:own"])).resolves.toBe(1n);
  });

  it("only lets users edit the messages that they wrote", async () => {
    const edit = (messageId: string): Promise<bigint> => {
      return asUser({ id: heidi, permissions: member }, (trx) => {
        return updateRows(trx, "ai_chat_messages", { content: "edited" }, { id: messageId });
      });
    };
    await expect(edit(userMessageId)).resolves.toBe(1n);
    await expect(edit(assistantMessageId)).resolves.toBe(0n);
  });

  it("only lets the owner of a chat delete its messages with the permission to", async () => {
    const messageId = await insertMessage(sessionId, "user");
    const remove = (permissions: string[]): Promise<bigint> => {
      return asUser({ id: heidi, permissions }, (trx) => deleteRows(trx, "ai_chat_messages", { id: messageId }));
    };
    await expect(remove(reader)).resolves.toBe(0n);
    await expect(remove([...reader, "ai_chat:delete:own"])).resolves.toBe(1n);
  });

  it("keeps the files of a chat to its owner", async () => {
    const files = { session_id: sessionId };
    const asMember = <T>(userId: string, callback: (trx: Transaction<Database>) => Promise<T>): Promise<T> => {
      return asUser({ id: userId, permissions: member }, callback);
    };

    await expect(
      asMember(ivan, (trx) => insertRow(trx, "ai_chat_session_vfs", { ...files, data: Buffer.from("") })),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asMember(heidi, (trx) => insertRow(trx, "ai_chat_session_vfs", { ...files, data: Buffer.from("") })),
    ).resolves.toBeUndefined();

    await expect(asMember(ivan, (trx) => countRows(trx, "ai_chat_session_vfs", files))).resolves.toBe(0);
    await expect(asMember(heidi, (trx) => countRows(trx, "ai_chat_session_vfs", files))).resolves.toBe(1);

    const saved = { updated_at: new Date() };
    await expect(asMember(ivan, (trx) => updateRows(trx, "ai_chat_session_vfs", saved, files))).resolves.toBe(0n);
    await expect(asMember(heidi, (trx) => updateRows(trx, "ai_chat_session_vfs", saved, files))).resolves.toBe(1n);

    await expect(asMember(ivan, (trx) => deleteRows(trx, "ai_chat_session_vfs", files))).resolves.toBe(0n);
    await expect(asMember(heidi, (trx) => deleteRows(trx, "ai_chat_session_vfs", files))).resolves.toBe(1n);
  });

  it("asks the owner of a chat for the permission to update it before changing its files", async () => {
    const files = { session_id: sessionId };
    const asOwner = <T>(permissions: string[], callback: (trx: Transaction<Database>) => Promise<T>): Promise<T> => {
      return asUser({ id: heidi, permissions }, callback);
    };
    const writer = [...reader, "ai_chat:update:own"];

    await expect(
      asOwner(reader, (trx) => insertRow(trx, "ai_chat_session_vfs", { ...files, data: Buffer.from("") })),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asOwner(writer, (trx) => insertRow(trx, "ai_chat_session_vfs", { ...files, data: Buffer.from("") })),
    ).resolves.toBeUndefined();

    await expect(asOwner([], (trx) => countRows(trx, "ai_chat_session_vfs", files))).resolves.toBe(0);
    await expect(asOwner(reader, (trx) => countRows(trx, "ai_chat_session_vfs", files))).resolves.toBe(1);

    const saved = { updated_at: new Date() };
    await expect(asOwner(reader, (trx) => updateRows(trx, "ai_chat_session_vfs", saved, files))).resolves.toBe(0n);
    await expect(asOwner(writer, (trx) => updateRows(trx, "ai_chat_session_vfs", saved, files))).resolves.toBe(1n);

    await expect(asOwner(reader, (trx) => deleteRows(trx, "ai_chat_session_vfs", files))).resolves.toBe(0n);
    await expect(asOwner(writer, (trx) => deleteRows(trx, "ai_chat_session_vfs", files))).resolves.toBe(1n);
  });

  it("lets the server write the tables of a chat for its owner", async () => {
    const write = (userId: string): Promise<InsertResult[]> => {
      return asUserWith({ id: userId, permissions: member }, { trustedWrites: true }, (trx) => {
        return trx
          .insertInto("aiChatTables")
          .values({ sessionId, data: Buffer.from(""), size: 0 })
          .execute();
      });
    };
    await expect(write(ivan)).rejects.toThrow(/row-level security/);
    await expect(write(heidi)).resolves.toBeDefined();
  });

  it("only lets the server update the tables of a chat", async () => {
    const update = (trustedWrites: boolean): Promise<bigint> => {
      return asUserWith({ id: heidi, permissions: member }, { trustedWrites }, (trx) => {
        return updateRows(trx, "ai_chat_tables", { size: 1 }, { session_id: sessionId });
      });
    };
    await expect(update(false)).resolves.toBe(0n);
    await expect(update(true)).resolves.toBeGreaterThan(0n);
  });

  it("only lets the server delete the tables that no message shows", async () => {
    const shown = await db
      .insertInto("aiChatTables")
      .values({ sessionId, messageId: assistantMessageId, data: Buffer.from(""), size: 0 })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    const unshown = await db
      .insertInto("aiChatTables")
      .values({ sessionId, data: Buffer.from(""), size: 0 })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    const remove = (id: string, trustedWrites = true): Promise<bigint> => {
      return asUserWith({ id: heidi, permissions: member }, { trustedWrites }, (trx) => {
        return deleteRows(trx, "ai_chat_tables", { id });
      });
    };
    await expect(remove(shown.id)).resolves.toBe(0n);
    await expect(remove(unshown.id, false)).resolves.toBe(0n);
    await expect(remove(unshown.id)).resolves.toBe(1n);
  });
});

// The values that a new row of each resource needs besides its name
describe.each([
  {
    resource: LlmProviderResource,
    insert: insertLlmProvider,
    values: { api_url: "http://llm.localhost/v1", api_key: "", headers: "" },
  },
  { resource: McpServerResource, insert: insertMcpServer, values: { url: "http://mcp.localhost/mcp", headers: "" } },
  { resource: SkillResource, insert: insertSkill, values: {} },
  { resource: AgentResource, insert: insertAgent, values: { type: "specialist", model: "m" } },
])("shared resource $resource.type", ({ resource, insert, values }) => {
  const editor = crypto.randomUUID();
  const user = crypto.randomUUID();
  const outsider = crypto.randomUUID();
  let resourceId: string;

  const can = (...actions: string[]): string[] => actions.map((action) => `${resource.type}:${action}`);

  const grant = (id: string, userId: string, role: "editor" | "user"): Promise<void> => {
    return insertRow(db, resource.accessTable, { [resource.foreignKey]: id, user_id: userId, role });
  };

  // A resource with an editor and a user
  const insertShared = async (): Promise<string> => {
    const id = await insert(db, `${resource.type}-${crypto.randomUUID()}`);
    await grant(id, editor, "editor");
    await grant(id, user, "user");
    return id;
  };

  beforeAll(async () => {
    await insertUsers(db, {
      [`${resource.type}-editor`]: editor,
      [`${resource.type}-user`]: user,
      [`${resource.type}-outsider`]: outsider,
    });
    resourceId = await insertShared();
  });

  it("shows a resource to the users that it is shared with", async () => {
    const visibleRows = (userId: string): Promise<number> => {
      return asUser({ id: userId, permissions: can("use:own") }, (trx) => {
        return countRows(trx, resource.table, { id: resourceId });
      });
    };
    await expect(visibleRows(user)).resolves.toBe(1);
    await expect(visibleRows(outsider)).resolves.toBe(0);
  });

  it("keeps a resource out of the lists of a user who can only read it", async () => {
    const visibleRows = (action: ResourceSelectAction): Promise<number> => {
      return asUserWith(
        { id: user, permissions: can("read:own") },
        { resourceScope: `${resource.type}:${action}` },
        (trx) => {
          return countRows(trx, resource.table, { id: resourceId });
        },
      );
    };
    await expect(visibleRows("read")).resolves.toBe(1);
    await expect(visibleRows("list")).resolves.toBe(0);
  });

  it("only lets the users who can create a resource create one", async () => {
    const create = (permissions: string[]): Promise<void> => {
      return asUser({ id: outsider, permissions }, (trx) => {
        return insertRow(trx, resource.table, { name: `${resource.type}-${crypto.randomUUID()}`, ...values });
      });
    };
    await expect(create(can("create"))).resolves.toBeUndefined();
    await expect(create(can("update:own"))).rejects.toThrow(/row-level security/);
  });

  it("only lets the editors of a resource update it", async () => {
    const update = (userId: string): Promise<bigint> => {
      return asUser({ id: userId, permissions: can("update:own") }, (trx) => {
        return updateRows(trx, resource.table, { updated_at: new Date() }, { id: resourceId });
      });
    };
    await expect(update(editor)).resolves.toBe(1n);
    await expect(update(user)).resolves.toBe(0n);
  });

  it("only lets the editors of a resource delete it", async () => {
    const id = await insertShared();
    const remove = (userId: string): Promise<bigint> => {
      return asUser({ id: userId, permissions: can("delete:own") }, (trx) => deleteRows(trx, resource.table, { id }));
    };
    await expect(remove(user)).resolves.toBe(0n);
    await expect(remove(editor)).resolves.toBe(1n);
  });

  it("shows all the grants of a resource to its readers and their own grants to its users", async () => {
    const visibleGrants = (permissions: string[]): Promise<number> => {
      return asUser({ id: user, permissions }, (trx) => {
        return countRows(trx, resource.accessTable, { [resource.foreignKey]: resourceId });
      });
    };
    await expect(visibleGrants(can("read:own"))).resolves.toBe(2);
    await expect(visibleGrants(can("use:own"))).resolves.toBe(1);
  });

  it("only lets the editors of a resource share it", async () => {
    const id = await insertShared();
    const share = (userId: string): Promise<void> => {
      return asUser({ id: userId, permissions: can("update:own") }, (trx) => {
        return insertRow(trx, resource.accessTable, { [resource.foreignKey]: id, user_id: outsider, role: "user" });
      });
    };
    await expect(share(user)).rejects.toThrow(/row-level security/);
    await expect(share(editor)).resolves.toBeUndefined();
  });

  it("only lets the editors of a resource revoke its grants", async () => {
    const id = await insertShared();
    await grant(id, outsider, "user");
    const revoke = (userId: string): Promise<bigint> => {
      return asUser({ id: userId, permissions: can("update:own") }, (trx) => {
        return deleteRows(trx, resource.accessTable, { [resource.foreignKey]: id, user_id: outsider });
      });
    };
    await expect(revoke(user)).resolves.toBe(0n);
    await expect(revoke(editor)).resolves.toBe(1n);
  });
});

describe("agent policies", () => {
  const judy = crypto.randomUUID();
  const builder = ["ai_agent:create", "ai_agent:read:own", "ai_agent:update:own", "ai_llm_provider:use:own"];
  let usableProviderId: string;
  let unusableProviderId: string;

  beforeAll(async () => {
    await insertUsers(db, { judy });
    usableProviderId = await insertLlmProvider(db, "usable-provider");
    unusableProviderId = await insertLlmProvider(db, "unusable-provider");
    await db
      .insertInto("aiLlmProviderAccess")
      .values({ llmProviderId: usableProviderId, userId: judy, role: "user" })
      .execute();
  });

  it("only lets users create agents with the LLM providers that they can use", async () => {
    const create = (llmProviderId: string): Promise<void> => {
      return asUser({ id: judy, permissions: builder }, (trx) => {
        const name = `agent-${crypto.randomUUID()}`;
        return insertRow(trx, "ai_agents", { name, type: "specialist", model: "m", llm_provider_id: llmProviderId });
      });
    };
    await expect(create(usableProviderId)).resolves.toBeUndefined();
    await expect(create(unusableProviderId)).rejects.toThrow(/row-level security/);
  });

  it("lets editors keep the LLM provider of an agent that they can no longer use", async () => {
    const linkedProviderId = await insertLlmProvider(db, "linked-provider");
    const agentId = await insertAgent(db, "linked-agent", { llmProviderId: linkedProviderId });
    await db.insertInto("aiAgentAccess").values({ agentId, userId: judy, role: "editor" }).execute();
    const update = (values: { name?: string; llmProviderId?: string }): Promise<bigint> => {
      return asUser({ id: judy, permissions: builder }, async (trx) => {
        const result = await trx.updateTable("aiAgents").set(values).where("id", "=", agentId).executeTakeFirst();
        return result.numUpdatedRows;
      });
    };
    await expect(update({ name: "renamed-linked-agent" })).resolves.toBe(1n);
    await expect(update({ llmProviderId: unusableProviderId })).rejects.toThrow(/row-level security/);
  });
});

describe("agent link policies", () => {
  const kevin = crypto.randomUUID();
  const laura = crypto.randomUUID();
  const mike = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const newAgentId = crypto.randomUUID();
  const serverId = crypto.randomUUID();
  const otherServerId = crypto.randomUUID();
  const skillId = crypto.randomUUID();
  const otherSkillId = crypto.randomUUID();
  const specialistId = crypto.randomUUID();
  const otherSpecialistId = crypto.randomUUID();
  // Builders edit the agents and use the resources that they link to them
  const builder = [
    "ai_agent:read:own",
    "ai_agent:update:own",
    "ai_agent:use:own",
    "ai_mcp_server:use:own",
    "ai_skill:use:own",
  ];

  beforeAll(async () => {
    await insertUsers(db, { kevin, laura, mike });
    for (const [id, name] of [
      [agentId, "linking-agent"],
      [newAgentId, "new-linking-agent"],
      [specialistId, "linked-specialist"],
      [otherSpecialistId, "unlinked-specialist"],
    ] as const) {
      await insertAgent(db, name, { id });
    }
    await insertMcpServer(db, "linked-server", { id: serverId });
    await insertMcpServer(db, "unlinked-server", { id: otherServerId });
    await insertSkill(db, "linked-skill", { id: skillId });
    await insertSkill(db, "unlinked-skill", { id: otherSkillId });

    // Kevin edits the agents and Laura uses them, and both can use the resources that are linked
    await db
      .insertInto("aiAgentAccess")
      .values(
        [agentId, newAgentId].flatMap((id) => [
          { agentId: id, userId: kevin, role: "editor" as const },
          { agentId: id, userId: laura, role: "user" as const },
        ]),
      )
      .execute();
    for (const userId of [kevin, laura]) {
      await db.insertInto("aiAgentAccess").values({ agentId: specialistId, userId, role: "user" }).execute();
      await db.insertInto("aiMcpServerAccess").values({ mcpServerId: serverId, userId, role: "user" }).execute();
      await db.insertInto("aiSkillAccess").values({ skillId, userId, role: "user" }).execute();
    }
  });

  describe.each<{ table: string; owner: string; link: Record<string, string>; unusable: Record<string, string> }>([
    {
      table: "ai_agent_mcp_servers",
      owner: "agent_id",
      link: { mcp_server_id: serverId },
      unusable: { mcp_server_id: otherServerId },
    },
    { table: "ai_agent_skills", owner: "agent_id", link: { skill_id: skillId }, unusable: { skill_id: otherSkillId } },
    {
      table: "ai_agent_tool_resources",
      owner: "agent_id",
      link: { resource_type: SkillResource.type, resource_id: skillId },
      unusable: { resource_type: SkillResource.type, resource_id: otherSkillId },
    },
    {
      table: "ai_triage_specialists",
      owner: "triage_agent_id",
      link: { specialist_agent_id: specialistId },
      unusable: { specialist_agent_id: otherSpecialistId },
    },
  ])("$table", ({ table, owner, link, unusable }) => {
    beforeAll(async () => {
      await insertRow(db, table, { [owner]: agentId, ...link });
    });

    it("only lets the editors of an agent link the resources that they can use", async () => {
      const add = (userId: string, values: Record<string, string>): Promise<void> => {
        return asUser({ id: userId, permissions: builder }, (trx) => {
          return insertRow(trx, table, { [owner]: newAgentId, ...values });
        });
      };
      await expect(add(laura, link)).rejects.toThrow(/row-level security/);
      await expect(add(kevin, unusable)).rejects.toThrow(/row-level security/);
      await expect(add(kevin, link)).resolves.toBeUndefined();
    });

    it("shows the links of an agent to the users who can use it", async () => {
      const visibleLinks = (userId: string): Promise<number> => {
        return asUser({ id: userId, permissions: ["ai_agent:use:own"] }, (trx) => {
          return countRows(trx, table, { [owner]: agentId });
        });
      };
      await expect(visibleLinks(laura)).resolves.toBe(1);
      await expect(visibleLinks(mike)).resolves.toBe(0);
    });

    it("only lets the editors of an agent unlink its resources", async () => {
      const remove = (userId: string): Promise<bigint> => {
        return asUser({ id: userId, permissions: builder }, (trx) => {
          return deleteRows(trx, table, { [owner]: agentId, ...link });
        });
      };
      await expect(remove(laura)).resolves.toBe(0n);
      await expect(remove(kevin)).resolves.toBe(1n);
    });
  });
});

describe("execution policies", () => {
  const nina = crypto.randomUUID();
  const oscar = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const executionId = crypto.randomUUID();
  const member = [...AiRolePermissions[Roles.Member]];
  const reader = ["ai_agent_execution:read:own"];
  let sessionId: string;

  beforeAll(async () => {
    await insertUsers(db, { nina, oscar });
    await insertAgent(db, "executing-agent", { id: agentId });
    await db
      .insertInto("aiAgentAccess")
      .values([
        { agentId, userId: nina, role: "user" },
        { agentId, userId: oscar, role: "user" },
      ])
      .execute();
    sessionId = await insertSession(nina, agentId);
    await db
      .insertInto("aiAgentExecutions")
      .values({ id: executionId, sessionId, agentId, userId: nina, status: "completed", lastActivityAt: new Date() })
      .execute();
  });

  it("only shows an execution to its user", async () => {
    const visibleExecutions = (userId: string): Promise<number> => {
      return asUser({ id: userId, permissions: member }, (trx) => {
        return countRows(trx, "ai_agent_executions", { id: executionId });
      });
    };
    await expect(visibleExecutions(nina)).resolves.toBe(1);
    await expect(visibleExecutions(oscar)).resolves.toBe(0);
  });

  it("only lets users run the agents that they can use in their own chats", async () => {
    const run = (userId: string, values: { agentId: string }): Promise<InsertResult[]> => {
      return asUser({ id: userId, permissions: member }, (trx) => {
        return trx
          .insertInto("aiAgentExecutions")
          .values({ sessionId, userId, status: "pending", lastActivityAt: new Date(), ...values })
          .execute();
      });
    };
    await expect(run(nina, { agentId })).resolves.toBeDefined();
    await expect(run(oscar, { agentId })).rejects.toThrow(/row-level security/);
    await expect(run(nina, { agentId: orphanAgentId })).rejects.toThrow(/row-level security/);
  });

  it("only lets users update their own executions with the permission to or through the server", async () => {
    const update = (userId: string, permissions: string[], trustedWrites = false): Promise<bigint> => {
      return asUserWith({ id: userId, permissions }, { trustedWrites }, (trx) => {
        return updateRows(trx, "ai_agent_executions", { last_activity_at: new Date() }, { id: executionId });
      });
    };
    await expect(update(nina, reader)).resolves.toBe(0n);
    await expect(update(oscar, [...reader, "ai_agent_execution:update:own"], true)).resolves.toBe(0n);
    await expect(update(nina, [...reader, "ai_agent_execution:update:own"])).resolves.toBe(1n);
    await expect(update(nina, reader, true)).resolves.toBe(1n);
  });

  describe.each([
    { table: "ai_agent_code_executions", values: { code: "", execution_ms: 0 } },
    { table: "ai_agent_tool_calls", values: { tool_name: "notes_read", arguments: "{}" } },
  ])("$table", ({ table, values }) => {
    const rowId = crypto.randomUUID();

    beforeAll(async () => {
      await insertRow(db, table, { id: rowId, execution_id: executionId, ...values });
    });

    it("only shows the steps of an execution to its user", async () => {
      const visibleRows = (userId: string): Promise<number> => {
        return asUser({ id: userId, permissions: member }, (trx) => countRows(trx, table, { id: rowId }));
      };
      await expect(visibleRows(nina)).resolves.toBe(1);
      await expect(visibleRows(oscar)).resolves.toBe(0);
    });

    it("only lets the user of an execution record its steps", async () => {
      const record = (userId: string): Promise<void> => {
        return asUser({ id: userId, permissions: member }, (trx) => {
          return insertRow(trx, table, { execution_id: executionId, ...values });
        });
      };
      await expect(record(oscar)).rejects.toThrow(/row-level security/);
      await expect(record(nina)).resolves.toBeUndefined();
    });

    it("only lets the user of an execution update its steps with the permission to", async () => {
      const update = (permissions: string[]): Promise<bigint> => {
        return asUser({ id: nina, permissions }, (trx) => {
          return updateRows(trx, table, { error_message: null }, { id: rowId });
        });
      };
      await expect(update(reader)).resolves.toBe(0n);
      await expect(update([...reader, "ai_chat:update:own"])).resolves.toBe(1n);
    });
  });
});

describe("system policies", () => {
  const pat = crypto.randomUUID();

  // Every table has a row of a user who would reach it with the permissions of a member
  beforeAll(async () => {
    await insertUsers(db, { pat });
    const llmProviderId = await insertLlmProvider(db, "system-provider");
    const mcpServerId = await insertMcpServer(db, "system-server");
    const skillId = await insertSkill(db, "system-skill");
    const agentId = await insertAgent(db, "system-agent");
    const triageAgentId = await insertAgent(db, "system-triage", { type: "triage" });
    await db.insertInto("aiLlmProviderAccess").values({ llmProviderId, userId: pat, role: "editor" }).execute();
    await db.insertInto("aiMcpServerAccess").values({ mcpServerId, userId: pat, role: "editor" }).execute();
    await db.insertInto("aiSkillAccess").values({ skillId, userId: pat, role: "editor" }).execute();
    await db.insertInto("aiAgentAccess").values({ agentId, userId: pat, role: "editor" }).execute();
    await db.insertInto("aiAgentMcpServers").values({ agentId, mcpServerId }).execute();
    await db.insertInto("aiAgentSkills").values({ agentId, skillId }).execute();
    await db
      .insertInto("aiAgentToolResources")
      .values({ agentId, resourceType: SkillResource.type, resourceId: skillId })
      .execute();
    await db.insertInto("aiTriageSpecialists").values({ triageAgentId, specialistAgentId: agentId }).execute();

    const sessionId = await insertSession(pat, agentId);
    await insertMessage(sessionId, "user");
    await db
      .insertInto("aiChatSessionVfs")
      .values({ sessionId, data: Buffer.from("") })
      .execute();
    await db
      .insertInto("aiChatTables")
      .values({ sessionId, data: Buffer.from(""), size: 0 })
      .execute();
    const execution = await db
      .insertInto("aiAgentExecutions")
      .values({ sessionId, agentId, userId: pat, status: "completed", lastActivityAt: new Date() })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    await db
      .insertInto("aiAgentCodeExecutions")
      .values({ executionId: execution.id, code: "", executionMs: 0 })
      .execute();
    await db
      .insertInto("aiAgentToolCalls")
      .values({ executionId: execution.id, toolName: "notes_read", arguments: "{}" })
      .execute();
  });

  it.each([
    "ai_chat_sessions",
    "ai_chat_messages",
    "ai_chat_session_vfs",
    "ai_chat_tables",
    "ai_llm_providers",
    "ai_llm_provider_access",
    "ai_mcp_servers",
    "ai_mcp_server_access",
    "ai_skills",
    "ai_skill_access",
    "ai_agents",
    "ai_agent_access",
    "ai_agent_mcp_servers",
    "ai_agent_skills",
    "ai_agent_tool_resources",
    "ai_triage_specialists",
    "ai_agent_executions",
    "ai_agent_code_executions",
    "ai_agent_tool_calls",
  ])("lets the transactions without a user read %s and keeps users without permissions out", async (table) => {
    await expect(countRows(db, table)).resolves.toBeGreaterThan(0);
    await expect(asUser({ id: pat, permissions: [] }, (trx) => countRows(trx, table))).resolves.toBe(0);
  });
});
