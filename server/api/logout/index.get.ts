import { appendHeader, createError, defineEventHandler, getCookie, sendRedirect } from "h3";
import { useRuntimeConfig } from "nitropack/runtime/config";

import { useLucia } from "~~/server/lib/authn/lucia";
import { useOIDC } from "~~/server/lib/authn/oidc";
import { AuthModes } from "~~/server/lib/authn/strategies";

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

  const lucia = useLucia();
  const oidc = useOIDC();
  const token = getCookie(event, lucia.cookieName);

  if (token) {
    appendHeader(event, "Set-Cookie", lucia.createSessionDeleteCookie());

    const { session } = await lucia.validateSession(token);

    if (session) {
      await lucia.invalidateSession(token);
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
