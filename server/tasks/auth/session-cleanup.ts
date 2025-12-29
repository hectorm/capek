import cluster from "node:cluster";

import { defineTask } from "nitropack/runtime/task";

import { useDb } from "~~/server/lib/database";
import { useLogger } from "~~/server/lib/logger";

const logger = useLogger();

export default defineTask({
  meta: {
    name: "auth:session-cleanup",
    description: "Clean up expired sessions",
  },
  async run() {
    if (cluster.isWorker) {
      return { result: true };
    }

    logger.info("Starting session cleanup task");

    try {
      const db = await useDb();

      const result = await db.deleteFrom("sessions").where("expiresAt", "<", new Date()).executeTakeFirst();
      const count = Number(result.numDeletedRows || 0);

      logger.info({ count }, "Session cleanup completed");
      return { result: true };
    } catch (error) {
      logger.error({ error }, "Session cleanup task failed");
      throw error;
    }
  },
});
