import { createError, defineEventHandler, getHeader } from "h3";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export default defineEventHandler((event) => {
  if (getHeader(event, "Transfer-Encoding") !== undefined) {
    throw createError({
      statusCode: 411,
      message: "Request bodies must declare their length",
    });
  }

  if (Number(getHeader(event, "Content-Length")) > MAX_BODY_BYTES) {
    throw createError({
      statusCode: 413,
      message: "Request body is too large",
    });
  }
});
