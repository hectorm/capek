import { defineTask } from "nitropack/runtime/task";

import { useDb } from "#layers/core/server/lib/database";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

export default defineTask({
  meta: {
    name: "auth:session-cleanup",
    description: "Clean up expired sessions",
  },
  async run() {
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
