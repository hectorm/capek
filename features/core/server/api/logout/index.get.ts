import { appendHeader, createError, defineEventHandler, getCookie, sendRedirect } from "h3";
import { useRuntimeConfig } from "nitropack/runtime/config";

import { useOIDC } from "#layers/core/server/lib/authn/oidc";
import { useSessions } from "#layers/core/server/lib/authn/sessions";
import { AuthModes } from "#layers/core/server/lib/authn/strategies";

const config = useRuntimeConfig();

export default defineEventHandler(async (event) => {
  const logger = event.context.logger;

  if (config.authMode !== AuthModes.OIDC) {
    logger.warn({ authMode: config.authMode }, "Logout attempted with non-OIDC auth mode");
    throw createError({
      statusCode: 400,
      message: "Unable to authenticate",
    });
  }

  const oidc = useOIDC();
  const sessions = useSessions();
  const token = getCookie(event, sessions.cookieName);

  if (token) {
    appendHeader(event, "Set-Cookie", sessions.createSessionDeleteCookie());

    const { session } = await sessions.validateSession(token);

    if (session) {
      await sessions.invalidateSession(token);
      logger.info({ userId: session.userId }, "User logged out");

      try {
        const endSessionUrl = await oidc.createEndSessionUrl(session.idToken);
        if (endSessionUrl) {
          await sendRedirect(event, endSessionUrl.toString());
          return;
        }
      } catch (error) {
        logger.error({ error }, "End session URL creation failed");
      }
    }
  }

  await sendRedirect(event, "/");
});
