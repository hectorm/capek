import { defineTask } from "nitropack/runtime/task";

import { MCPManager } from "#layers/ai/server/lib/mcp/manager";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

export default defineTask({
  meta: {
    name: "ai:mcp-session-cleanup",
    description: "Clean up stale MCP sessions of inactive chat sessions",
  },
  async run() {
    logger.info("Starting MCP session cleanup task");

    try {
      const count = await MCPManager.getInstance().cleanupIdleSessions();

      logger.info({ count }, "MCP session cleanup completed");
      return { result: true };
    } catch (error) {
      logger.error({ error }, "MCP session cleanup task failed");
      throw error;
    }
  },
});
