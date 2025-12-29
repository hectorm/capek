import cluster from "node:cluster";

import { defineTask } from "nitropack/runtime/task";

import { useDb } from "~~/server/lib/database";
import { migrateToLatest } from "~~/server/lib/database/migrator";
import { useLogger } from "~~/server/lib/logger";

const logger = useLogger();

export default defineTask({
  meta: {
    name: "database:migrate",
    description: "Run database migrations",
  },
  async run() {
    if (cluster.isWorker) {
      return { result: true };
    }

    logger.info("Starting database migrations task");

    try {
      const db = await useDb();

      await migrateToLatest(db);

      logger.info("Database migrations completed");
      return { result: true };
    } catch (error) {
      logger.error({ error }, "Database migrations failed");
      return { result: false, error };
    }
  },
});
