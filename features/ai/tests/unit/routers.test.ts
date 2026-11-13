import http from "node:http";
import type { AddressInfo } from "node:net";

import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RoleName } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import { ensureToolsDiscovered } from "#layers/ai/server/lib/mcp/tools";
import { llmProviderRouter } from "#layers/ai/server/trpc/routers/llmProvider";
import { mcpServerRouter } from "#layers/ai/server/trpc/routers/mcpServer";
import { AiRolePermissions } from "#layers/ai/shared/rbac";
import { closeDb, createAiTestDb } from "#layers/ai/tests/unit/helpers/db";
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

const router = createTRPCRouter({ llmProvider: llmProviderRouter, mcpServer: mcpServerRouter });
const logger = { warn: () => undefined, info: () => undefined, debug: () => undefined } as unknown as Logger;

const as = (id: string, role: RoleName) => {
  const permissions = [...CoreRolePermissions[role], ...AiRolePermissions[role]];
  return createCallerFactory(router)({ logger, user: { id, groups: [], permissions } });
};

beforeAll(async () => {
  endpoint = http.createServer((req, res) => {
    requests.push(`${String(req.method)} ${String(req.url)} ${req.headers.authorization ?? "-"}`);
    if (req.url?.startsWith("/moved")) {
      res.writeHead(307, { Location: `${endpointUrl}${req.method === "GET" ? "/v1/models" : "/mcp"}` }).end();
    } else {
      res.writeHead(403).end(`denied ${"x".repeat(5000)}`);
    }
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  endpointUrl = `http://127.0.0.1:${String((endpoint.address() as AddressInfo).port)}`;

  db = await createAiTestDb();

  await db
    .insertInto("users")
    .values([
      { id: alice, username: "alice", fullname: "Alice", email: "alice@example.com" },
      { id: mallory, username: "mallory", fullname: "Mallory", email: "mallory@example.com" },
    ])
    .execute();

  await db
    .insertInto("aiLlmProviders")
    .values({
      id: llmProviderId,
      name: "provider",
      description: "",
      apiUrl: `${endpointUrl}/v1`,
      apiType: "chat-completions",
      apiKey: "",
      headers: JSON.stringify([]),
    })
    .execute();
  await db.insertInto("aiLlmProviderAccess").values({ llmProviderId, userId: mallory, role: "user" }).execute();

  await db
    .insertInto("aiMcpServers")
    .values({
      id: mcpServerId,
      name: "server",
      description: "",
      url: `${endpointUrl}/mcp`,
      headers: JSON.stringify([]),
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

describe("connection tests", () => {
  it("are not run for those who can neither create nor update what they test", async () => {
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

  it("are run for those who can create what they test, and tell the start of what a failed request answers", async () => {
    const creator = as(alice, Roles.Creator);

    const llmProvider = await creator.llmProvider.testConnection({ apiUrl: `${endpointUrl}/v1`, apiKey: "typed-key" });
    expect(llmProvider).toEqual({
      success: false,
      error: `AI service models request failed: denied ${"x".repeat(993)}…`,
    });

    const mcpServer = await creator.mcpServer.testConnection({ url: `${endpointUrl}/mcp` });
    expect(mcpServer).toEqual({
      success: false,
      error: `MCP request failed with status 403: denied ${"x".repeat(993)}…`,
    });

    expect(requests).toEqual(["GET /v1/models Bearer typed-key", "POST /mcp -"]);
  });

  it("do not follow redirects", async () => {
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

describe("tool discoveries", () => {
  it("are not repeated at once for the servers that gave no tools", async () => {
    await expect(ensureToolsDiscovered(db, mcpServerId)).rejects.toThrow(/status 403/);
    expect(await ensureToolsDiscovered(db, mcpServerId)).toEqual([]);

    expect(requests).toEqual(["POST /mcp -"]);
  });
});

describe("access lists", () => {
  it("are only given for the resources that can be read", async () => {
    const member = as(mallory, Roles.Member);

    expect(await member.llmProvider.listAccess({ llmProviderId })).toHaveLength(1);
    await expect(member.mcpServer.listAccess({ mcpServerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
