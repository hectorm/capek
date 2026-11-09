import cluster from "node:cluster";

import { defineNitroPlugin } from "nitropack/runtime/plugin";

import { setupMCPIPCHandler } from "#layers/ai/server/lib/mcp/ipc";

export default defineNitroPlugin((): void => {
  if (cluster.isPrimary) {
    setupMCPIPCHandler();
  }
});
