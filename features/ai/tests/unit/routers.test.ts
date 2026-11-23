import http from "node:http";
import { deflateSync } from "node:zlib";
import type { AddressInfo } from "node:net";

import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { MCPTool } from "#layers/ai/shared/mcp";
import type { PermissionName, RoleName } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import { ensureToolsDiscovered } from "#layers/ai/server/lib/mcp/tools";
import { agentRouter } from "#layers/ai/server/trpc/routers/agent";
import { chatMessageRouter } from "#layers/ai/server/trpc/routers/chat-message";
import { chatSessionRouter } from "#layers/ai/server/trpc/routers/chat-session";
import { chatTableRouter } from "#layers/ai/server/trpc/routers/chat-table";
import { llmProviderRouter } from "#layers/ai/server/trpc/routers/llm-provider";
import { mcpServerRouter } from "#layers/ai/server/trpc/routers/mcp-server";
import { skillRouter } from "#layers/ai/server/trpc/routers/skill";
import { AiPermissions, AiRolePermissions } from "#layers/ai/shared/rbac";
import {
  closeDb,
  createAiTestDb,
  createTestCaller,
  insertAgent,
  insertChatSession,
  insertLlmProvider,
  insertMcpServer,
  insertSkill,
  insertUsers,
} from "#layers/ai/tests/unit/helpers/db";
import { createTRPCRouter } from "#layers/core/server/trpc/init";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";
import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";

let db: Kysely<Database>;

let endpoint: http.Server;
let endpointUrl: string;
const requests: string[] = [];

let toolList: { tools: MCPTool[]; ttlMs?: number } | null = null;

const alice = crypto.randomUUID();
const mallory = crypto.randomUUID();
const llmProviderId = crypto.randomUUID();
const mcpServerId = crypto.randomUUID();

const router = createTRPCRouter({
  agent: agentRouter,
  chatMessage: chatMessageRouter,
  chatSession: chatSessionRouter,
  chatTable: chatTableRouter,
  llmProvider: llmProviderRouter,
  mcpServer: mcpServerRouter,
  skill: skillRouter,
});
const rolePermissions = (role: RoleName): PermissionName[] => {
  return [...CoreRolePermissions[role], ...AiRolePermissions[role]];
};

beforeAll(async () => {
  endpoint = http.createServer((req, res) => {
    requests.push(`${String(req.method)} ${String(req.url)} ${req.headers.authorization ?? "-"}`);
    if (req.url?.startsWith("/moved")) {
      res.writeHead(307, { Location: `${endpointUrl}${req.method === "GET" ? "/v1/models" : "/mcp"}` }).end();
    } else if (req.url?.startsWith("/tools") || req.url?.startsWith("/slow")) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const { id, method } = JSON.parse(Buffer.concat(chunks).toString()) as { id: number; method: string };
        if (req.url?.startsWith("/slow") && method === "tools/list") {
          return;
        }
        const result = method === "server/discover" ? { supportedVersions: ["2026-07-28"] } : toolList;
        res
          .writeHead(result ? 200 : 500, { "Content-Type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      });
    } else if (req.url?.startsWith("/api")) {
      res
        .writeHead(404, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: { message: "No such model" } }));
    } else {
      res.writeHead(403).end("internal secret");
    }
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  endpointUrl = `http://127.0.0.1:${String((endpoint.address() as AddressInfo).port)}`;
  Object.assign(runtimeConfig, { allowedPrivateHosts: new URL(endpointUrl).host });

  db = await createAiTestDb();

  await insertUsers(db, { alice, mallory });
  await insertLlmProvider(db, "provider", { id: llmProviderId, apiUrl: `${endpointUrl}/v1`, apiKey: "" });
  await db.insertInto("aiLlmProviderAccess").values({ llmProviderId, userId: mallory, role: "user" }).execute();

  await insertMcpServer(db, "server", { id: mcpServerId, url: `${endpointUrl}/mcp` });
});

beforeEach(() => {
  requests.length = 0;
});

afterAll(async () => {
  await new Promise((resolve) => endpoint.close(resolve));
  await closeDb();
});

describe("connection test", () => {
  it("is not run for users who can neither create nor update the resource", async () => {
    const member = createTestCaller(router, { id: mallory, permissions: rolePermissions(Roles.Member) });
    const apiUrl = `${endpointUrl}/v1`;
    const url = `${endpointUrl}/mcp`;

    await expect(member.llmProvider.testConnection({ apiUrl })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.mcpServer.testConnection({ url })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Testing an existing endpoint requires update access
    await expect(member.llmProvider.testConnection({ id: llmProviderId, apiUrl })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(member.mcpServer.testConnection({ id: mcpServerId, url })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    expect(requests).toEqual([]);
  });

  it("reports the message of an API error", async () => {
    const creator = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Creator) });

    const llmProvider = await creator.llmProvider.testConnection({ apiUrl: `${endpointUrl}/api`, apiKey: "key" });
    expect(llmProvider).toEqual({
      success: false,
      error: "AI service models request failed: 404 Not Found: No such model",
    });

    const mcpServer = await creator.mcpServer.testConnection({ url: `${endpointUrl}/api` });
    expect(mcpServer).toEqual({ success: false, error: "MCP request failed: 404 Not Found: No such model" });

    expect(requests).toEqual(["GET /api/models Bearer key", "POST /api -", "POST /api -"]);
  });

  it("does not report the body of another service", async () => {
    const creator = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Creator) });

    const llmProvider = await creator.llmProvider.testConnection({ apiUrl: `${endpointUrl}/v1`, apiKey: "key" });
    expect(llmProvider).toEqual({ success: false, error: "AI service models request failed: 403 Forbidden" });

    const mcpServer = await creator.mcpServer.testConnection({ url: `${endpointUrl}/mcp` });
    expect(mcpServer).toEqual({ success: false, error: "MCP request failed: 403 Forbidden" });

    expect(requests).toEqual(["GET /v1/models Bearer key", "POST /mcp -"]);
  });

  it("does not follow redirects", async () => {
    const creator = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Creator) });

    const llmProvider = await creator.llmProvider.testConnection({ apiUrl: `${endpointUrl}/moved`, apiKey: "key" });
    expect(llmProvider).toEqual({
      success: false,
      error: `The endpoint redirects to "${endpointUrl}/v1/models", its URL has to be changed`,
    });

    const mcpServer = await creator.mcpServer.testConnection({ url: `${endpointUrl}/moved` });
    expect(mcpServer).toEqual({
      success: false,
      error: `The endpoint redirects to "${endpointUrl}/mcp", its URL has to be changed`,
    });

    expect(requests).toEqual(["GET /moved/models Bearer key", "POST /moved -"]);
  });
});

describe("tool discovery", () => {
  it("is not repeated at once for a server without tools", async () => {
    await expect(ensureToolsDiscovered(db, mcpServerId)).rejects.toThrow(/403 Forbidden/);
    expect(await ensureToolsDiscovered(db, mcpServerId)).toEqual([]);

    expect(requests).toEqual(["POST /mcp -"]);
  });

  it("is repeated when the time to keep the tools of a server is over", async () => {
    const id = await insertMcpServer(db, "tools", { url: `${endpointUrl}/tools` });
    const expire = async (): Promise<void> => {
      await db
        .updateTable("aiMcpServers")
        .set({ cachedToolsExpiresAt: new Date(0) })
        .where("id", "=", id)
        .execute();
    };
    const search: MCPTool = { name: "search", inputSchema: { type: "object" } };
    const read: MCPTool = { name: "read", inputSchema: { type: "object" } };

    toolList = { tools: [search], ttlMs: 60 * 60 * 1000 };
    expect(await ensureToolsDiscovered(db, id)).toEqual([search]);
    toolList = { tools: [search, read] };
    expect(await ensureToolsDiscovered(db, id)).toEqual([search]);
    expect(requests).toEqual(["POST /tools -", "POST /tools -"]);

    await expire();
    expect(await ensureToolsDiscovered(db, id)).toEqual([search, read]);
    expect(requests).toHaveLength(4);

    const { cachedToolsExpiresAt } = await db
      .selectFrom("aiMcpServers")
      .select(["cachedToolsExpiresAt"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect((cachedToolsExpiresAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(50_000);
    expect((cachedToolsExpiresAt?.getTime() ?? 0) - Date.now()).toBeLessThanOrEqual(60_000);

    await expire();
    toolList = null;
    expect(await ensureToolsDiscovered(db, id)).toEqual([search, read]);
  });

  it("stops at the deadline of its caller", async () => {
    const id = await insertMcpServer(db, "slow", { url: `${endpointUrl}/slow` });

    for (let i = 0; i < 2; i++) {
      await expect(ensureToolsDiscovered(db, id, AbortSignal.timeout(200))).rejects.toMatchObject({
        name: "TimeoutError",
      });
    }
    expect(requests).toEqual(["POST /slow -", "POST /slow -", "POST /slow -", "POST /slow -"]);
  });
});

describe("agent", () => {
  it("requires the read scope for details and linked resources, and the list scope for search", async () => {
    const shared = await insertAgent(db, "scope-shared");
    const unshared = await insertAgent(db, "scope-unshared");
    await db.insertInto("aiAgentAccess").values({ agentId: shared, userId: mallory, role: "user" }).execute();

    const { AgentListAll, AgentListOwn, AgentReadAll, AgentReadOwn } = AiPermissions;
    const browse = createTestCaller(router, { id: mallory, permissions: [AgentListAll, AgentReadOwn] }).agent;
    await expect(browse.read({ id: shared })).resolves.toMatchObject({ id: shared });
    await expect(browse.read({ id: unshared })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(browse.listSkills({ agentId: unshared })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const read = createTestCaller(router, { id: mallory, permissions: [AgentReadAll, AgentListOwn] }).agent;
    await expect(read.search({ search: "scope-", limit: 1 })).resolves.toEqual({
      agents: [expect.objectContaining({ id: shared })],
      nextCursor: undefined,
    });
  });

  it("applies specialist settings consistently when creating and updating an agent", async () => {
    const { agent } = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Admin) });
    const tools = { codeInterpreter: true, toolProviders: ["ai_tables"] };
    const triage = await agent.create({ name: "router", type: "triage", model: "m", ...tools });
    const disabled = { codeInterpreter: false, toolProviders: [] };
    expect(triage).toMatchObject(disabled);
    expect(await agent.update({ id: triage.id, ...tools })).toMatchObject(disabled);

    const specialist = await agent.create({ name: "specialist-settings", type: "specialist", model: "m", ...tools });
    expect(await agent.update({ id: specialist.id, ...disabled })).toMatchObject(disabled);
    expect(await agent.update({ id: specialist.id, ...tools })).toMatchObject(tools);
    await expect(agent.update({ id: specialist.id, toolProviders: ["missing"] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await agent.update({ id: specialist.id, description: "changed" })).toMatchObject(tools);
  });

  it("rejects specialist settings written directly to a triage agent", async () => {
    const id = await insertAgent(db, "triage-settings", { type: "triage" });
    for (const settings of [{ codeInterpreter: true }, { toolProviders: ["ai_tables"] }]) {
      await expect(db.updateTable("aiAgents").set(settings).where("id", "=", id).execute()).rejects.toMatchObject({
        constraint: "ai_agents_specialist_settings_check",
      });
    }
  });

  it("is saved with what it is assigned, or not at all", async () => {
    const creator = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Creator) });
    const skillId = await insertSkill(db, "assigned");
    await db.insertInto("aiSkillAccess").values({ skillId, userId: alice, role: "user" }).execute();
    const skillIds = [crypto.randomUUID()];

    const twice = [skillId, skillId.toUpperCase()];
    const { id } = await creator.agent.create({ name: "saved", type: "specialist", model: "m", skillIds: twice });
    expect(await db.selectFrom("aiAgentSkills").select(["skillId"]).where("agentId", "=", id).execute()).toEqual([
      { skillId },
    ]);

    await expect(
      creator.agent.create({ name: "unsaved", type: "specialist", model: "m", skillIds }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.selectFrom("aiAgents").select(["id"]).where("name", "=", "unsaved").execute()).toEqual([]);

    await expect(creator.agent.update({ id, description: "changed", skillIds })).rejects.toThrow("what it is assigned");
    const agent = await db.selectFrom("aiAgents").select(["description"]).where("id", "=", id).executeTakeFirst();
    expect(agent).toEqual({ description: "" });
  });

  it("is not saved with what does not exist, even by who can use everything", async () => {
    const admin = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Admin) });
    const skillIds = [crypto.randomUUID()];

    await expect(admin.agent.create({ name: "unsaved", type: "specialist", model: "m", skillIds })).rejects.toThrow(
      "some of what the agent is assigned does not exist",
    );
  });
});

describe("shared resource", () => {
  it("requires the read scope for details and the list scope for search", async () => {
    // Only the first resource is shared
    const expectScopes = async (
      [shared, unshared]: [string, string],
      browse: { read: (input: { id: string }) => Promise<unknown> },
      reader: { search: (input: { search: string; limit: number }) => Promise<unknown> },
      listed: string,
    ): Promise<void> => {
      await expect(browse.read({ id: shared })).resolves.toMatchObject({ id: shared });
      await expect(browse.read({ id: unshared })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(reader.search({ search: "scope-", limit: 1 })).resolves.toEqual({
        [listed]: [expect.objectContaining({ id: shared })],
        nextCursor: undefined,
      });
    };
    const {
      LlmProviderListAll,
      LlmProviderListOwn,
      LlmProviderReadAll,
      LlmProviderReadOwn,
      McpServerListAll,
      McpServerListOwn,
      McpServerReadAll,
      McpServerReadOwn,
      SkillListAll,
      SkillListOwn,
      SkillReadAll,
      SkillReadOwn,
    } = AiPermissions;

    const llmProviders: [string, string] = [
      await insertLlmProvider(db, "scope-shared"),
      await insertLlmProvider(db, "scope-unshared"),
    ];
    await db
      .insertInto("aiLlmProviderAccess")
      .values({ llmProviderId: llmProviders[0], userId: mallory, role: "user" })
      .execute();
    await expectScopes(
      llmProviders,
      createTestCaller(router, { id: mallory, permissions: [LlmProviderListAll, LlmProviderReadOwn] }).llmProvider,
      createTestCaller(router, { id: mallory, permissions: [LlmProviderReadAll, LlmProviderListOwn] }).llmProvider,
      "llmProviders",
    );

    const mcpServers: [string, string] = [
      await insertMcpServer(db, "scope-shared"),
      await insertMcpServer(db, "scope-unshared"),
    ];
    await db
      .insertInto("aiMcpServerAccess")
      .values({ mcpServerId: mcpServers[0], userId: mallory, role: "user" })
      .execute();
    await expectScopes(
      mcpServers,
      createTestCaller(router, { id: mallory, permissions: [McpServerListAll, McpServerReadOwn] }).mcpServer,
      createTestCaller(router, { id: mallory, permissions: [McpServerReadAll, McpServerListOwn] }).mcpServer,
      "mcpServers",
    );

    const skills: [string, string] = [await insertSkill(db, "scope-shared"), await insertSkill(db, "scope-unshared")];
    await db.insertInto("aiSkillAccess").values({ skillId: skills[0], userId: mallory, role: "user" }).execute();
    await expectScopes(
      skills,
      createTestCaller(router, { id: mallory, permissions: [SkillListAll, SkillReadOwn] }).skill,
      createTestCaller(router, { id: mallory, permissions: [SkillReadAll, SkillListOwn] }).skill,
      "skills",
    );
  });

  it("is saved with its access, or not at all", async () => {
    const creator = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Creator) });
    const access = [
      { id: alice, type: "user" as const, role: "editor" as const },
      { id: mallory, type: "user" as const, role: "user" as const },
    ];

    const { id } = await creator.mcpServer.create({ name: "shared", url: `${endpointUrl}/mcp`, headers: [], access });
    const saved = await db
      .selectFrom("aiMcpServerAccess")
      .select(["userId", "role"])
      .where("mcpServerId", "=", id)
      .orderBy("role")
      .execute();
    expect(saved).toEqual([
      { userId: alice, role: "editor" },
      { userId: mallory, role: "user" },
    ]);

    const missing = [{ id: crypto.randomUUID(), type: "user" as const, role: "user" as const }];
    await expect(
      creator.mcpServer.create({ name: "unsaved", url: `${endpointUrl}/mcp`, headers: [], access: missing }),
    ).rejects.toThrow("One or more users or groups do not exist");
    expect(await db.selectFrom("aiMcpServers").select(["id"]).where("name", "=", "unsaved").execute()).toEqual([]);
  });
});

describe("access list", () => {
  it("is only given for a readable resource", async () => {
    const member = createTestCaller(router, { id: mallory, permissions: rolePermissions(Roles.Member) });

    expect(await member.llmProvider.listAccess({ llmProviderId })).toHaveLength(1);
    await expect(member.mcpServer.listAccess({ mcpServerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("chat access", () => {
  it("separates the scope for listing chats from the scope for reading their content", async () => {
    const own = crypto.randomUUID();
    const other = crypto.randomUUID();
    const tableId = crypto.randomUUID();
    const agentId = await insertAgent(db, "scope-chat-agent");
    await insertChatSession(db, alice, { id: own, title: "scope-own", agentId });
    await insertChatSession(db, mallory, { id: other, title: "scope-other", agentId });
    await db
      .insertInto("aiChatMessages")
      .values({ sessionId: other, role: "user", content: "Private message" })
      .execute();
    const data = JSON.stringify({ columns: ["value"], rows: [["Private table"]] });
    await db
      .insertInto("aiChatTables")
      .values({ id: tableId, sessionId: other, data: deflateSync(data), size: data.length })
      .execute();

    const { AgentReadAll, ChatListAll, ChatListOwn, ChatReadAll, ChatReadOwn, ChatUpdateOwn } = AiPermissions;
    const browse = createTestCaller(router, { id: alice, permissions: [ChatListAll, ChatReadOwn] });
    await expect(
      browse.chatSession.search({ search: "scope-", orderBy: "title", order: "asc" }),
    ).resolves.toMatchObject({
      sessions: [{ id: other }, { id: own }],
    });
    await expect(browse.chatSession.read({ id: other })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(browse.chatMessage.list({ sessionId: other })).resolves.toMatchObject({ messages: [] });
    await expect(browse.chatTable.read({ id: tableId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const read = createTestCaller(router, {
      id: alice,
      permissions: [AgentReadAll, ChatListOwn, ChatReadAll, ChatUpdateOwn],
    });
    await expect(read.chatSession.search({ search: "scope-" })).resolves.toMatchObject({
      sessions: [expect.objectContaining({ id: own })],
    });
    await expect(read.chatMessage.list({ sessionId: other })).resolves.toMatchObject({
      messages: [{ content: "Private message" }],
    });
    await expect(read.chatTable.read({ id: tableId })).resolves.toBe(data);
    await expect(read.chatSession.generateTitle({ id: other })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("chat message", () => {
  it("is deleted with the ones after it", async () => {
    const insertMessage = async (session: string, content: string, createdAt: string): Promise<string> => {
      const result = await sql<{ id: string }>`
        INSERT INTO ai_chat_messages (session_id, role, content, created_at)
        VALUES (${session}, 'user', ${content}, ${createdAt}::TIMESTAMPTZ)
        RETURNING id
      `.execute(db);
      return result.rows[0]?.id ?? "";
    };
    const contents = async (session: string): Promise<string[]> => {
      const rows = await db
        .selectFrom("aiChatMessages")
        .select(["content"])
        .where("sessionId", "=", session)
        .orderBy("createdAt")
        .execute();
      return rows.map((row) => row.content);
    };

    const sessionId = await insertChatSession(db, alice);
    const otherSessionId = await insertChatSession(db, alice);
    await insertMessage(sessionId, "first", "2025-01-01T00:01:00.123100Z");
    const second = await insertMessage(sessionId, "second", "2025-01-01T00:01:00.123900Z");
    await insertMessage(sessionId, "third", "2025-01-01T00:02:00Z");
    await insertMessage(otherSessionId, "other", "2025-01-01T00:03:00Z");

    const { chatMessage } = createTestCaller(router, { id: alice, permissions: rolePermissions(Roles.Member) });
    await chatMessage.delete({ id: second, sessionId });

    expect(await contents(sessionId)).toEqual(["first"]);
    expect(await contents(otherSessionId)).toEqual(["other"]);
  });
});
