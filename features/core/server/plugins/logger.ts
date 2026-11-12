import type { NitroApp } from "nitropack";
import { isError } from "h3";
import { defineNitroPlugin } from "nitropack/runtime/plugin";

import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

export default defineNitroPlugin((nitroApp: NitroApp): void => {
  nitroApp.hooks.hook("error", (error: unknown) => {
    if (isError(error) && error.statusCode < 500) {
      return;
    }
    logger.error({ error }, "Nitro error occurred");
  });
});
