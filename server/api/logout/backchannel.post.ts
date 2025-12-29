import { createError, defineEventHandler, readBody, sendNoContent } from "h3";
import { useRuntimeConfig } from "nitropack/runtime/config";
import { z } from "zod/v4";

import { useLucia } from "~~/server/lib/authn/lucia";
import { useOIDC } from "~~/server/lib/authn/oidc";
import { AuthModes } from "~~/server/lib/authn/strategies";
import { useDb } from "~~/server/lib/database";

const config = useRuntimeConfig();

const bodySchema = z.object({
  logout_token: z.string().max(10000),
});

// OpenID Connect Back-Channel Logout 1.0 endpoint
// See: https://openid.net/specs/openid-connect-backchannel-1_0.html
export default defineEventHandler(async (event) => {
  const logger = event.context.logger;

  if (config.authMode !== AuthModes.OIDC) {
    logger.warn({ authMode: config.authMode }, "Backchannel logout attempted with non-OIDC auth mode");
    throw createError({
      statusCode: 400,
      message: "Unable to authenticate",
    });
  }

  const db = await useDb();
  const lucia = useLucia();
  const oidc = useOIDC();

  try {
    const rawBody: unknown = await readBody(event);
    const body = bodySchema.parse(rawBody);

    const payload = await oidc.validateBackchannelLogoutToken(body.logout_token);

    // If logout token contains sid, invalidate all sessions with that sid
    if (payload.sid) {
      const sid = typeof payload.sid === "string" ? payload.sid : JSON.stringify(payload.sid);
      await lucia.invalidateSessionsBySid(sid);
      logger.info({ sid: payload.sid }, "Sessions invalidated by sid via backchannel logout");

      sendNoContent(event);
      return;
    }

    // If logout token contains iss and sub, find the user and invalidate all their sessions
    if (payload.iss && payload.sub) {
      const iss = typeof payload.iss === "string" ? payload.iss : JSON.stringify(payload.iss);
      const sub = typeof payload.sub === "string" ? payload.sub : JSON.stringify(payload.sub);
      const account = await db
        .selectFrom("accounts")
        .select("userId")
        .where("iss", "=", iss)
        .where("sub", "=", sub)
        .executeTakeFirst();

      if (account) {
        await lucia.invalidateAllSessions(account.userId);
        logger.info({ userId: account.userId }, "User sessions invalidated via backchannel logout");
      }

      sendNoContent(event);
      return;
    }

    logger.warn("Backchannel logout token missing sid and sub claims");
    sendNoContent(event);
    return;
  } catch (error) {
    logger.error({ error }, "Backchannel logout processing failed");
    throw createError({
      statusCode: 500,
      message: "Failed to process backchannel logout",
    });
  }
});
