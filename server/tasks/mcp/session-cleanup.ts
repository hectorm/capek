import cluster from "node:cluster";

import { defineTask } from "nitropack/runtime/task";

import { useDb } from "~~/server/lib/database";
import { useLogger } from "~~/server/lib/logger";
import { MCPManager } from "~~/server/lib/mcp/manager";

const logger = useLogger();

export default defineTask({
  meta: {
    name: "mcp:session-cleanup",
    description: "Clean up stale MCP sessions for deleted or inactive chat sessions",
  },
  async run() {
    if (cluster.isWorker) {
      return { result: true };
    }

    logger.info("Starting MCP session cleanup task");

    try {
      const db = await useDb();

      const mcpServersExist = await db.selectFrom("mcpServers").select("id").limit(1).executeTakeFirst();
      if (!mcpServersExist) {
        logger.debug("No MCP servers configured, skipping cleanup");
        return { result: true };
      }

      const mcpManager = MCPManager.getInstance();

      const activeSessions = await db.selectFrom("chatSessions").select(["id"]).execute();
      const activeSessionIds = new Set(activeSessions.map((s) => s.id));

      const mcpSessionIds = mcpManager.getTrackedSessionIds();

      let count = 0;
      for (const mcpSessionId of mcpSessionIds) {
        if (!activeSessionIds.has(mcpSessionId)) {
          await mcpManager.cleanupSession(mcpSessionId);
          count++;
        }
      }

      logger.info({ count }, "MCP session cleanup completed");
      return { result: true };
    } catch (error) {
      logger.error({ error }, "MCP session cleanup task failed");
      throw error;
    }
  },
});
