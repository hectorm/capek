import { defineTask } from "nitropack/runtime/task";

import { AgentExecutor } from "#layers/ai/server/lib/agents/executor";
import { useDb } from "#layers/core/server/lib/database";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

export default defineTask({
  meta: {
    name: "ai:agent-execution-cleanup",
    description: "Mark abandoned agent executions as failed",
  },
  run: async () => {
    logger.info("Starting abandoned executions cleanup task");

    try {
      const db = await useDb();
      const count = await AgentExecutor.failAbandonedExecutions(db);

      logger.info({ count }, "Abandoned executions cleanup completed");
      return { result: true };
    } catch (error) {
      logger.error({ error }, "Failed to cleanup abandoned executions");
      throw error;
    }
  },
});
