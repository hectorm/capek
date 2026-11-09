import cluster from "node:cluster";

import { defineTask } from "nitropack/runtime/task";

import { useDb } from "#layers/core/server/lib/database";
import { migrateToLatest } from "#layers/core/server/lib/database/migrator";
import { getServerFeatures } from "#layers/core/server/lib/features";
import { useLogger } from "#layers/core/server/lib/logger";
import { useSettingDefinitions } from "#layers/core/server/lib/settings";

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
      useSettingDefinitions();

      const db = await useDb();

      await migrateToLatest(db, getServerFeatures());

      logger.info("Database migrations completed");
      return { result: true };
    } catch (error) {
      logger.error({ error }, "Database migrations failed");
      return { result: false, error };
    }
  },
});
