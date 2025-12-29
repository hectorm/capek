import { createError, defineEventHandler, getRequestURL, sendRedirect, setCookie } from "h3";
import { useRuntimeConfig } from "nitropack/runtime/config";

import { useOIDC } from "~~/server/lib/authn/oidc";
import { AuthModes } from "~~/server/lib/authn/strategies";

const config = useRuntimeConfig();

export default defineEventHandler(async (event) => {
  const logger = event.context.logger;

  if (config.authMode !== AuthModes.OIDC) {
    logger.warn({ authMode: config.authMode }, "Login attempted with non-OIDC auth mode");
    throw createError({
      statusCode: 400,
      message: "Unable to authenticate",
    });
  }

  const oidc = useOIDC();
  const loginUrl = getRequestURL(event, { xForwardedProto: true, xForwardedHost: true });

  let redirect;
  try {
    const url = new URL(loginUrl.searchParams.get("redirect") ?? "/", oidc.rootUrl);
    if (url.origin === oidc.rootUrl.origin) redirect = url;
  } catch {
    /* Ignore invalid URLs */
  }

  if (!redirect) {
    logger.warn({ redirect: loginUrl.searchParams.get("redirect") }, "Invalid redirect URL");
    throw createError({
      status: 400,
      message: "Invalid redirect URL",
    });
  }

  try {
    const codeVerifier = oidc.generateCodeVerifier();
    const state = oidc.generateState({ redirect });
    const nonce = oidc.generateNonce();

    const cookieOptions = {
      path: "/",
      httpOnly: true,
      sameSite: "lax" as const,
      secure: !import.meta.dev,
      partitioned: !import.meta.dev,
    };

    setCookie(event, oidc.codeVerifierCookieName, codeVerifier, cookieOptions);
    setCookie(event, oidc.stateCookieName, state, cookieOptions);
    setCookie(event, oidc.nonceCookieName, nonce, cookieOptions);

    const authUrl = await oidc.createAuthorizationUrl(codeVerifier, state, nonce);

    await sendRedirect(event, authUrl.toString());
    return;
  } catch (error) {
    logger.error({ error }, "Login initiation failed");
    throw createError({
      statusCode: 500,
      message: "Failed to initiate login",
    });
  }
});
