import cluster from "node:cluster";

import { defineNitroPlugin } from "nitropack/runtime/plugin";

import { setupMCPIPCHandler } from "~~/server/lib/mcp/ipc";

export default defineNitroPlugin((): void => {
  if (cluster.isPrimary) {
    setupMCPIPCHandler();
  }
});
