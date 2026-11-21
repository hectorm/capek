import process from "node:process";

import { useRuntimeConfig } from "nitropack/runtime/config";
import { defineNitroPlugin } from "nitropack/runtime/plugin";

import { AuthModes } from "#layers/core/server/lib/authn/strategies";
import { useLogger } from "#layers/core/server/lib/logger";

const config = useRuntimeConfig();
const logger = useLogger();

export default defineNitroPlugin((): void => {
  if (!Object.values<string>(AuthModes).includes(config.authMode)) {
    logger.error({ authMode: config.authMode, authModes: Object.values(AuthModes) }, "NUXT_AUTH_MODE is not valid");
    process.exit(1);
  }

  if (config.authMode === AuthModes.Proxy && !config.proxy.secret.trim()) {
    logger.error("NUXT_PROXY_SECRET must be set to authenticate through a proxy");
    process.exit(1);
  }
});
