import { createError, defineEventHandler, getHeader } from "h3";

import { collectBodyLimits, resolveBodyLimit } from "#layers/core/server/lib/body-limit";
import { getServerFeatures } from "#layers/core/server/lib/features";

const limits = collectBodyLimits(getServerFeatures());

export default defineEventHandler(async (event) => {
  if (getHeader(event, "Transfer-Encoding") !== undefined) {
    throw createError({
      statusCode: 411,
      message: "Request bodies must declare their length",
    });
  }

  if (Number(getHeader(event, "Content-Length")) > (await resolveBodyLimit(limits, event))) {
    throw createError({
      statusCode: 413,
      message: "Request body is too large",
    });
  }
});
