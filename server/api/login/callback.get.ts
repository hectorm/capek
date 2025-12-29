import {
  appendHeader,
  createError,
  defineEventHandler,
  deleteCookie,
  getCookie,
  getRequestURL,
  sendRedirect,
} from "h3";
import { useRuntimeConfig } from "nitropack/runtime/config";

import { useLucia } from "~~/server/lib/authn/lucia";
import { useOIDC } from "~~/server/lib/authn/oidc";
import { AuthModes } from "~~/server/lib/authn/strategies";
import { getOrCreateUserFromOIDC, syncUserGroups, syncUserRoles } from "~~/server/lib/authn/sync";

const config = useRuntimeConfig();

export default defineEventHandler(async (event) => {
  const logger = event.context.logger;

  if (config.authMode !== AuthModes.OIDC) {
    throw createError({
      statusCode: 400,
      message: "Unable to authenticate",
    });
  }

  const lucia = useLucia();
  const oidc = useOIDC();
  const callbackUrl = getRequestURL(event, { xForwardedProto: true, xForwardedHost: true });
  const callbackError = callbackUrl.searchParams.get("error");
  const callbackErrorDescription = callbackUrl.searchParams.get("error_description");

  if (callbackError) {
    logger.error({ error: callbackError, errorDescription: callbackErrorDescription }, "OIDC callback error");
    throw createError({
      statusCode: 400,
      message: `Authentication failed: ${callbackError}`,
    });
  }

  const storedCodeVerifier = getCookie(event, oidc.codeVerifierCookieName);
  const storedState = getCookie(event, oidc.stateCookieName);
  const storedNonce = getCookie(event, oidc.nonceCookieName);

  if (!storedCodeVerifier || !storedState || !storedNonce) {
    logger.error("Authorization callback cookies missing");
    throw createError({
      statusCode: 400,
      message: "Missing session data",
    });
  }

  deleteCookie(event, oidc.codeVerifierCookieName);
  deleteCookie(event, oidc.stateCookieName);
  deleteCookie(event, oidc.nonceCookieName);

  let tokens;
  try {
    tokens = await oidc.validateAuthorizationCallback(callbackUrl, storedCodeVerifier, storedState, storedNonce);
  } catch (error) {
    logger.error({ error }, "Authorization code validation failed");
    throw createError({
      statusCode: 400,
      message: "Failed to validate callback",
    });
  }

  // We currently support only one OIDC provider at a time, but this may be expanded in the future.
  if (tokens.idTokenClaims.iss !== oidc.as.issuer) {
    logger.error({ issuer: tokens.idTokenClaims.iss }, "Token issuer unexpected");
    throw createError({
      statusCode: 403,
      message: "Unexpected issuer in token",
    });
  }

  let profile;
  try {
    profile = await oidc.getUserProfile(tokens.idTokenClaims, tokens.accessToken);
  } catch (error) {
    logger.error({ error }, "User profile retrieval failed");
    throw createError({
      statusCode: 500,
      message: "Failed to retrieve user profile",
    });
  }

  if (!profile) {
    logger.error("User profile empty");
    throw createError({
      statusCode: 403,
      message: "Not allowed to authenticate",
    });
  }

  let user;
  try {
    user = await getOrCreateUserFromOIDC({
      username: profile.preferred_username,
      fullname: profile.name,
      email: profile.email,
      picture: profile.picture ?? null,
      iss: tokens.idTokenClaims.iss,
      sub: tokens.idTokenClaims.sub,
    });

    if (config.oidc.syncRoles && Array.isArray(profile.roles)) {
      await syncUserRoles(user.id, profile.roles);
    }

    if (config.oidc.syncGroups && Array.isArray(profile.groups)) {
      await syncUserGroups(user.id, profile.groups);
    }
  } catch (error) {
    logger.error({ error }, "User creation or update failed");
    throw createError({
      statusCode: 500,
      message: "Failed to get or create user",
    });
  }

  const session = await lucia.createSession(user.id, tokens.idTokenClaims.sid, tokens.idToken);
  appendHeader(event, "Set-Cookie", lucia.createSessionCookie(session.token, session.expiresAt));

  const parsedState = oidc.parseState(storedState);

  let redirect;
  try {
    const redirectParam = parsedState?.redirect;
    const url = new URL(typeof redirectParam === "string" ? redirectParam : "/", oidc.rootUrl);
    if (url.origin === oidc.rootUrl.origin) redirect = url;
  } catch {
    /* Ignore invalid URLs */
  }

  if (!redirect) {
    throw createError({
      status: 400,
      message: "Invalid redirect URL",
    });
  }

  logger.info({ userId: user.id, email: profile.email }, "User logged in via OIDC");
  return sendRedirect(event, redirect.toString());
});
