import type { Kysely } from "kysely";
import { z } from "zod/v4";

import type { MCPConnection } from "#layers/ai/server/lib/mcp/connection";
import type { MCPTool } from "#layers/ai/shared/mcp";
import type { HttpHeader } from "#layers/core/shared/http";
import type { Database } from "#layers/core/shared/schema";
import { connect } from "#layers/ai/server/lib/mcp/client";
import { decryptMcpServerHeaders } from "#layers/ai/server/lib/secrets";
import { MCPToolSchema } from "#layers/ai/shared/mcp";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

const DISCOVERY_TIMEOUT_MS = 10_000;
const DISCOVERY_RETRY_MS = 60_000;

const TOOLS_TTL_MIN_MS = 60_000;
const TOOLS_TTL_MAX_MS = 24 * 60 * 60_000;

const unavailable = new Map<string, { config: string; since: number }>();

export interface MCPServerInfo {
  id: string;
  name: string;
  url: string;
  headers: HttpHeader[];
  stateful: boolean;
  toolCallTimeoutSec: number | null;
  cachedTools: MCPTool[];
  cachedToolsExpiresAt: Date | null;
}

export const hasFreshTools = (server: Pick<MCPServerInfo, "cachedTools" | "cachedToolsExpiresAt">): boolean => {
  return server.cachedTools.length > 0 && (server.cachedToolsExpiresAt?.getTime() ?? 0) > Date.now();
};

export const ensureToolsDiscovered = async (db: Kysely<Database>, mcpServerId: string): Promise<MCPTool[]> => {
  const server = await db
    .selectFrom("aiMcpServers")
    .select(["id", "name", "url", "headers", "stateful", "cachedTools", "cachedToolsExpiresAt"])
    .where("id", "=", mcpServerId)
    .executeTakeFirst();

  if (!server) {
    throw new Error(`MCP server not found: ${mcpServerId}`);
  }

  const parsed = z.array(MCPToolSchema).safeParse(server.cachedTools);
  const cached = parsed.success ? parsed.data : [];
  if (hasFreshTools({ cachedTools: cached, cachedToolsExpiresAt: server.cachedToolsExpiresAt })) {
    logger.debug({ mcpServerId, serverName: server.name, toolCount: cached.length }, "Using cached MCP tools");
    return cached;
  }

  const headers = decryptMcpServerHeaders(server.headers);
  const config = JSON.stringify([server.url, headers]);
  const last = unavailable.get(mcpServerId);
  if (last?.config === config && Date.now() - last.since < DISCOVERY_RETRY_MS) {
    return cached;
  }

  logger.info({ mcpServerId, serverName: server.name, url: server.url }, "Discovering tools from MCP server");

  let connection: MCPConnection | undefined;
  let tools: MCPTool[] = [];
  try {
    connection = await connect({
      name: server.name,
      url: server.url,
      headers,
      stateful: false,
      timeoutMs: DISCOVERY_TIMEOUT_MS,
    });
    const listed = await connection.listTools();
    tools = listed.tools;

    const ttlMs = Math.min(Math.max(listed.ttlMs, TOOLS_TTL_MIN_MS), TOOLS_TTL_MAX_MS);
    await db
      .updateTable("aiMcpServers")
      .set({ cachedTools: JSON.stringify(tools), cachedToolsExpiresAt: new Date(Date.now() + ttlMs) })
      .where("id", "=", mcpServerId)
      .execute();

    logger.info({ mcpServerId, serverName: server.name, toolCount: tools.length }, "MCP tools discovered and cached");
    return tools;
  } catch (error) {
    logger.error({ mcpServerId, serverName: server.name, error }, "Failed to discover MCP tools");

    if (cached.length > 0) {
      return cached;
    }
    throw new Error(
      `Failed to discover tools from MCP server: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    await connection?.close();
    if (tools.length === 0) {
      unavailable.set(mcpServerId, { config, since: Date.now() });
    }
  }
};
