import cluster from "node:cluster";
import process from "node:process";

import type { NitroApp } from "nitropack/types";
import { defineNitroPlugin } from "nitropack/runtime/plugin";
import { runTask } from "nitropack/runtime/task";

import { closeDb } from "#layers/core/server/lib/database";
import { useLogger } from "#layers/core/server/lib/logger";
import { loadEncryptionKeys } from "#layers/core/server/lib/secrets";

const READY_MESSAGE = "core:database-ready";

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
    ? (async (): Promise<void> => {
        await new Promise<void>((resolve) => {
          const onMessage = (message: unknown): void => {
            if (message === READY_MESSAGE) {
              process.off("message", onMessage);
              resolve();
            }
          };
          process.on("message", onMessage);
          process.send?.(READY_MESSAGE);
        });
        await loadKeys();
      })()
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
    let released: Promise<void> | null = null;
    cluster.on("message", (worker, message: unknown) => {
      if (message === READY_MESSAGE) {
        // Hand the database over to the workers
        released ??= ready.then(closeDb);
        void released.then(() => {
          if (worker.isConnected()) {
            worker.send(READY_MESSAGE);
          }
        });
      }
    });
  }

  nitroApp.hooks.hook("request", () => ready);
});
