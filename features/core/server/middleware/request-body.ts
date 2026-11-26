import { createError, defineEventHandler, getHeader } from "h3";

import { getServerFeatures } from "#layers/core/server/lib/features";
import { collectBodyLimits, resolveBodyLimit, startBodyDeadline } from "#layers/core/server/lib/request-body";

const limits = collectBodyLimits(getServerFeatures());

export default defineEventHandler(async (event) => {
  if (getHeader(event, "Transfer-Encoding") !== undefined) {
    throw createError({
      statusCode: 411,
      message: "Request bodies must declare their length",
    });
  }

  const length = Number(getHeader(event, "Content-Length"));
  if (length > (await resolveBodyLimit(limits, event))) {
    throw createError({
      statusCode: 413,
      message: "Request body is too large",
    });
  }

  if (length > 0) {
    startBodyDeadline(event);
  }
});
