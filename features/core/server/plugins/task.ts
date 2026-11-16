import cluster from "node:cluster";
import process from "node:process";

import type { NitroApp } from "nitropack/types";
import { defineNitroPlugin } from "nitropack/runtime/plugin";
import { runTask } from "nitropack/runtime/task";

import { setupDbHandover } from "#layers/core/server/lib/database";
import { useLogger } from "#layers/core/server/lib/logger";
import { loadEncryptionKeys } from "#layers/core/server/lib/secrets";

const logger = useLogger();

const loadKeys = async (): Promise<void> => {
  try {
    await loadEncryptionKeys();
  } catch (error) {
    logger.error({ error }, "Encryption keys could not be loaded");
    process.exit(1);
  }
};

export default defineNitroPlugin((nitroApp: NitroApp): void => {
  const ready = cluster.isWorker
    ? loadKeys()
    : (async (): Promise<void> => {
        if (!(await runTask("database:migrate")).result) {
          process.exit(1);
        }
        await loadKeys();
        if (!(await runTask("database:seed")).result) {
          process.exit(1);
        }
      })();

  if (cluster.isPrimary) {
    setupDbHandover(ready);
  }

  nitroApp.hooks.hook("request", () => ready);
});
