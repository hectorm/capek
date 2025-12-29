import process from "node:process";

import type { NitroApp } from "nitropack/types";
import { defineNitroPlugin } from "nitropack/runtime/plugin";
import { runTask } from "nitropack/runtime/task";

export default defineNitroPlugin((nitroApp: NitroApp): void => {
  const ready = (async (): Promise<void> => {
    if (!(await runTask("database:migrate")).result) process.exit(1);
    if (!(await runTask("database:seed")).result) process.exit(1);
  })();
  nitroApp.hooks.hook("request", () => ready);
});
