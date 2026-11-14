import http from "node:http";
import type { AddressInfo } from "node:net";

import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { RoleName } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import { ensureToolsDiscovered } from "#layers/ai/server/lib/mcp/tools";
import { encryptMcpServerHeaders } from "#layers/ai/server/lib/secrets";
import { chatMessageRouter } from "#layers/ai/server/trpc/routers/chatMessage";
import { llmProviderRouter } from "#layers/ai/server/trpc/routers/llmProvider";
import { mcpServerRouter } from "#layers/ai/server/trpc/routers/mcpServer";
import { AiRolePermissions } from "#layers/ai/shared/rbac";
import { closeDb, createAiTestDb, insertLlmProvider, insertUsers } from "#layers/ai/tests/unit/helpers/db";
import { createCallerFactory, createTRPCRouter } from "#layers/core/server/trpc/init";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";

let db: Kysely<Database>;

// Endpoint that keeps the requests it receives
let endpoint: http.Server;
let endpointUrl: string;
const requests: string[] = [];

const alice = crypto.randomUUID();
const mallory = crypto.randomUUID();
const llmProviderId = crypto.randomUUID();
const mcpServerId = crypto.randomUUID();

const router = createTRPCRouter({
  chatMessage: chatMessageRouter,
  llmProvider: llmProviderRouter,
  mcpServer: mcpServerRouter,
});
const logger = { warn: () => undefined, info: () => undefined, debug: () => undefined } as unknown as Logger;

const as = (id: string, role: RoleName) => {
  const permissions = [...CoreRolePermissions[role], ...AiRolePermissions[role]];
  return createCallerFactory(router)({ logger, user: { id, groups: [], permissions } as unknown as AuthUser });
};

beforeAll(async () => {
  endpoint = http.createServer((req, res) => {
    requests.push(`${String(req.method)} ${String(req.url)} ${req.headers.authorization ?? "-"}`);
    if (req.url?.startsWith("/moved")) {
      res.writeHead(307, { Location: `${endpointUrl}${req.method === "GET" ? "/v1/models" : "/mcp"}` }).end();
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

  db = await createAiTestDb();

  await insertUsers(db, { alice, mallory });
  await insertLlmProvider(db, "provider", { id: llmProviderId, apiUrl: `${endpointUrl}/v1`, apiKey: "" });
  await db.insertInto("aiLlmProviderAccess").values({ llmProviderId, userId: mallory, role: "user" }).execute();

  await db
    .insertInto("aiMcpServers")
    .values({
      id: mcpServerId,
      name: "server",
      description: "",
      url: `${endpointUrl}/mcp`,
      headers: encryptMcpServerHeaders([]),
      stateful: false,
      toolCallTimeoutSec: null,
      cachedTools: JSON.stringify([]),
    })
    .execute();
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
    const member = as(mallory, Roles.Member);
    const apiUrl = `${endpointUrl}/v1`;
    const url = `${endpointUrl}/mcp`;

    await expect(member.llmProvider.testConnection({ apiUrl })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.mcpServer.testConnection({ url })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Nor with an ID that they cannot update
    await expect(member.llmProvider.testConnection({ id: llmProviderId, apiUrl })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(member.mcpServer.testConnection({ id: mcpServerId, url })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    expect(requests).toEqual([]);
  });

  it("reports the message of an API error", async () => {
    const creator = as(alice, Roles.Creator);

    const llmProvider = await creator.llmProvider.testConnection({ apiUrl: `${endpointUrl}/api`, apiKey: "key" });
    expect(llmProvider).toEqual({
      success: false,
      error: "AI service models request failed: 404 Not Found: No such model",
    });

    const mcpServer = await creator.mcpServer.testConnection({ url: `${endpointUrl}/api` });
    expect(mcpServer).toEqual({ success: false, error: "MCP request failed: 404 Not Found: No such model" });

    expect(requests).toEqual(["GET /api/models Bearer key", "POST /api -"]);
  });

  it("does not report the body of another service", async () => {
    const creator = as(alice, Roles.Creator);

    const llmProvider = await creator.llmProvider.testConnection({ apiUrl: `${endpointUrl}/v1`, apiKey: "key" });
    expect(llmProvider).toEqual({ success: false, error: "AI service models request failed: 403 Forbidden" });

    const mcpServer = await creator.mcpServer.testConnection({ url: `${endpointUrl}/mcp` });
    expect(mcpServer).toEqual({ success: false, error: "MCP request failed: 403 Forbidden" });

    expect(requests).toEqual(["GET /v1/models Bearer key", "POST /mcp -"]);
  });

  it("does not follow redirects", async () => {
    const creator = as(alice, Roles.Creator);

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
});

describe("access list", () => {
  it("is only given for a readable resource", async () => {
    const member = as(mallory, Roles.Member);

    expect(await member.llmProvider.listAccess({ llmProviderId })).toHaveLength(1);
    await expect(member.mcpServer.listAccess({ mcpServerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("chat message", () => {
  it("is deleted with the ones after it", async () => {
    const createSession = async (): Promise<string> => {
      const session = await db
        .insertInto("aiChatSessions")
        .values({ userId: alice, agentId: null, title: "" })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      return session.id;
    };
    const insertMessage = async (session: string, content: string, minute: number): Promise<string> => {
      const createdAt = new Date(Date.UTC(2025, 0, 1, 0, minute));
      const result = await sql<{ id: string }>`
        INSERT INTO ai_chat_messages (session_id, role, content, created_at)
        VALUES (${session}, 'user', ${content}, ${createdAt})
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

    const sessionId = await createSession();
    const otherSessionId = await createSession();
    await insertMessage(sessionId, "first", 1);
    const second = await insertMessage(sessionId, "second", 2);
    await insertMessage(sessionId, "third", 3);
    await insertMessage(otherSessionId, "other", 4);

    await as(alice, Roles.Member).chatMessage.delete({ id: second, sessionId });

    expect(await contents(sessionId)).toEqual(["first"]);
    expect(await contents(otherSessionId)).toEqual(["other"]);
  });
});
