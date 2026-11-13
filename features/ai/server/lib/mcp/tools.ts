import type { Kysely } from "kysely";
import { z } from "zod/v4";

import type { MCPTool } from "#layers/ai/shared/mcp";
import type { HttpHeader } from "#layers/core/shared/http";
import type { Database } from "#layers/core/shared/schema";
import { MCPClient } from "#layers/ai/server/lib/mcp/client";
import { MCPToolSchema } from "#layers/ai/shared/mcp";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

const DISCOVERY_TIMEOUT_MS = 10_000;
const DISCOVERY_RETRY_MS = 60_000;

const unavailable = new Map<string, { config: string; since: number }>();

export interface MCPServerInfo {
  id: string;
  name: string;
  url: string;
  headers: HttpHeader[];
  stateful: boolean;
  toolCallTimeoutSec: number | null;
  cachedTools: MCPTool[];
}

export async function ensureToolsDiscovered(db: Kysely<Database>, mcpServerId: string): Promise<MCPTool[]> {
  const server = await db
    .selectFrom("aiMcpServers")
    .select(["id", "name", "url", "headers", "stateful", "cachedTools"])
    .where("id", "=", mcpServerId)
    .executeTakeFirst();

  if (!server) {
    throw new Error(`MCP server not found: ${mcpServerId}`);
  }

  const parsed = z.array(MCPToolSchema).safeParse(server.cachedTools);
  const cached = parsed.success ? parsed.data : [];
  if (cached.length > 0) {
    logger.debug({ mcpServerId, serverName: server.name, toolCount: cached.length }, "Using cached MCP tools");
    return cached;
  }

  const config = JSON.stringify([server.url, server.headers]);
  const last = unavailable.get(mcpServerId);
  if (last?.config === config && Date.now() - last.since < DISCOVERY_RETRY_MS) {
    return cached;
  }

  logger.info({ mcpServerId, serverName: server.name, url: server.url }, "Discovering tools from MCP server");

  const client = new MCPClient({
    name: server.name,
    url: server.url,
    headers: server.headers,
    stateful: false,
    timeoutMs: DISCOVERY_TIMEOUT_MS,
  });
  let tools: MCPTool[] = [];
  try {
    await client.initialize();
    tools = await client.listTools();

    await db
      .updateTable("aiMcpServers")
      .set({ cachedTools: JSON.stringify(tools) })
      .where("id", "=", mcpServerId)
      .execute();

    logger.info({ mcpServerId, serverName: server.name, toolCount: tools.length }, "MCP tools discovered and cached");
    return tools;
  } catch (error) {
    logger.error({ mcpServerId, serverName: server.name, error }, "Failed to discover MCP tools");
    throw new Error(
      `Failed to discover tools from MCP server: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    await client.terminate();
    if (tools.length === 0) {
      unavailable.set(mcpServerId, { config, since: Date.now() });
    }
  }
}
