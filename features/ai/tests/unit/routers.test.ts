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

  it("reports the start of a failed response to users who can create the resource", async () => {
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
    await expect(ensureToolsDiscovered(db, mcpServerId)).rejects.toThrow(/status 403/);
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
