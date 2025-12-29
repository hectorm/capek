import type { Kysely } from "kysely";
import { z } from "zod/v4";

import type { HttpHeader } from "~~/shared/http";
import type { MCPTool } from "~~/shared/mcp";
import type { Database } from "~~/shared/schema";
import { useLogger } from "~~/server/lib/logger";
import { MCPClient } from "~~/server/lib/mcp/client";
import { MCPToolSchema } from "~~/shared/mcp";

const logger = useLogger();

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
    .selectFrom("mcpServers")
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

  logger.info({ mcpServerId, serverName: server.name, url: server.url }, "Discovering tools from MCP server");

  try {
    const client = new MCPClient({ name: server.name, url: server.url, headers: server.headers, stateful: false });
    await client.initialize();
    const tools = await client.listTools();
    await client.terminate();

    await db
      .updateTable("mcpServers")
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
  }
}

export function findServerForTool(
  toolName: string,
  servers: MCPServerInfo[],
): {
  id: string;
  name: string;
  url: string;
  headers: HttpHeader[];
  stateful: boolean;
  toolCallTimeoutSec: number | null;
} | null {
  for (const server of servers) {
    const tool = server.cachedTools.find((t) => t.name === toolName);
    if (tool) {
      return {
        id: server.id,
        name: server.name,
        url: server.url,
        headers: server.headers,
        stateful: server.stateful,
        toolCallTimeoutSec: server.toolCallTimeoutSec,
      };
    }
  }
  return null;
}
