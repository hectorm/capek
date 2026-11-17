import process from "node:process";

import { useRuntimeConfig } from "nitropack/runtime/config";
import { defineNitroPlugin } from "nitropack/runtime/plugin";

import { useLogger } from "#layers/core/server/lib/logger";
import { parseHostList } from "#layers/core/server/lib/network";

const config = useRuntimeConfig();
const logger = useLogger();

export default defineNitroPlugin((): void => {
  try {
    parseHostList(config.allowedPrivateHosts);
  } catch (error) {
    logger.error({ error }, "NUXT_ALLOWED_PRIVATE_HOSTS is not valid");
    process.exit(1);
  }
});
