import type { NitroApp } from "nitropack";
import { defineNitroPlugin } from "nitropack/runtime/plugin";

import { useLogger } from "~~/server/lib/logger";

const logger = useLogger();

export default defineNitroPlugin((nitroApp: NitroApp): void => {
  nitroApp.hooks.hook("error", (error: unknown) => {
    logger.error({ error }, "Nitro error occurred");
  });
});
