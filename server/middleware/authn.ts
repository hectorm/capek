import type { Logger } from "pino";
import { createError, defineEventHandler, getHeader, setHeader } from "h3";

import type { AuthUser } from "~~/server/lib/authn/strategies";
import { getAuthStrategy } from "~~/server/lib/authn/strategies";
import { useLogger } from "~~/server/lib/logger";

declare module "h3" {
  interface H3EventContext {
    user: AuthUser | null;
    logger: Logger;
  }
}

const logger = useLogger();

export default defineEventHandler(async (event) => {
  const requestId = crypto.randomUUID();
  const loggerContext: Record<string, string> = { requestId };

  // Include request ID in response headers for client-side correlation
  setHeader(event, "X-Request-ID", requestId);

  if (event.path.startsWith("/api/")) {
    // CSRF protection
    if (event.method !== "GET" && event.method !== "HEAD" && event.method !== "OPTIONS") {
      if (getHeader(event, "Sec-Fetch-Site") === "cross-site") {
        throw createError({
          statusCode: 403,
          message: "Cross-site requests are not allowed",
        });
      }
    }

    // Authentication
    const strategy = getAuthStrategy();
    const user = await strategy.getUserFromEvent(event);
    event.context.user = user;
  } else {
    event.context.user = null;
  }

  if (event.context.user) {
    loggerContext.requestUserId = event.context.user.id;
  }

  event.context.logger = logger.child(loggerContext);
});
