import cluster from "node:cluster";

import { defineTask } from "nitropack/runtime/task";

import { useDb } from "~~/server/lib/database";
import { useLogger } from "~~/server/lib/logger";

const logger = useLogger();

export default defineTask({
  meta: {
    name: "agent:execution-cleanup",
    description: "Mark abandoned agent executions as failed",
  },
  run: async () => {
    if (cluster.isWorker) {
      return { result: true };
    }

    logger.info("Starting abandoned executions cleanup task");

    try {
      const db = await useDb();
      const timeoutMinutes = 60;
      const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);

      const result = await db
        .updateTable("agentExecutions")
        .set({
          status: "failed",
          errorMessage: `Execution abandoned (no activity for over ${String(timeoutMinutes)} minutes)`,
          completedAt: new Date(),
          lastActivityAt: new Date(),
        })
        .where("status", "=", "running")
        .where("lastActivityAt", "<", cutoffTime)
        .returning(["id", "sessionId", "agentId"])
        .execute();
      const count = result.length;

      logger.info({ count }, "Abandoned executions cleanup completed");
      return { result: true };
    } catch (error) {
      logger.error({ error }, "Failed to cleanup abandoned executions");
      throw error;
    }
  },
});
