import { channel } from "node:diagnostics_channel";
import http from "node:http";
import https from "node:https";

import { defineNitroPlugin } from "nitropack/runtime/plugin";

// Nitro exposes its HTTP server only when the server starts listening
export default defineNitroPlugin((): void => {
  channel("tracing:net.server.listen:asyncStart").subscribe((context) => {
    const { server } = context as { server: unknown };
    if (server instanceof http.Server || server instanceof https.Server) {
      // The request-body middleware gives each body a deadline of its own
      server.requestTimeout = 0;
    }
  });
});
