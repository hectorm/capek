import cluster from "node:cluster";
import process from "node:process";

import type { NitroApp } from "nitropack/types";
import { defineNitroPlugin } from "nitropack/runtime/plugin";
import { runTask } from "nitropack/runtime/task";

const READY_MESSAGE = "core:database-ready";

export default defineNitroPlugin((nitroApp: NitroApp): void => {
  const ready = cluster.isWorker
    ? new Promise<void>((resolve) => {
        const onMessage = (message: unknown): void => {
          if (message === READY_MESSAGE) {
            process.off("message", onMessage);
            resolve();
          }
        };
        process.on("message", onMessage);
        process.send?.(READY_MESSAGE);
      })
    : (async (): Promise<void> => {
        if (!(await runTask("database:migrate")).result) {
          process.exit(1);
        }
        if (!(await runTask("database:seed")).result) {
          process.exit(1);
        }
      })();

  if (cluster.isPrimary) {
    cluster.on("message", (worker, message: unknown) => {
      if (message === READY_MESSAGE) {
        void ready.then(() => {
          if (worker.isConnected()) {
            worker.send(READY_MESSAGE);
          }
        });
      }
    });
  }

  nitroApp.hooks.hook("request", () => ready);
});
