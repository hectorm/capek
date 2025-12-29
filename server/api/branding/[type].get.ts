import { Buffer } from "node:buffer";

import { createError, defineEventHandler, getRouterParam, sendRedirect, setHeader } from "h3";
import { z } from "zod/v4";

import { getSetting } from "~~/server/lib/settings";

const typeSchema = z.enum(["logo", "icon"]);

const allowedMimeTypes = new Set([
  "image/png",
  "image/webp",
  "image/jpeg",
  "image/jxl",
  "image/avif",
  "image/gif",
  "image/svg+xml",
]);

export default defineEventHandler(async (event) => {
  const typeParam = getRouterParam(event, "type");
  const type = typeSchema.safeParse(typeParam);
  if (!type.success) {
    throw createError({
      statusCode: 404,
      message: "Not Found",
    });
  }

  const dataUri = await getSetting(`branding.${type.data}`);
  if (!dataUri) {
    return sendRedirect(event, `/${type.data}.svg`, 302);
  }

  const dataUriMatch = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
  if (!dataUriMatch) {
    throw createError({
      statusCode: 500,
      message: "Invalid image data",
    });
  }

  const mimeType = dataUriMatch[1];
  const base64Data = dataUriMatch[2];
  if (!mimeType || !base64Data) {
    throw createError({
      statusCode: 500,
      message: "Invalid image data",
    });
  }

  if (!allowedMimeTypes.has(mimeType)) {
    throw createError({
      statusCode: 400,
      message: "Invalid image type",
    });
  }

  const data = Buffer.from(base64Data, "base64");
  const etag = `"${Buffer.from(base64Data.substring(0, 32)).toString("base64")}"`;

  setHeader(event, "Content-Type", mimeType);
  setHeader(event, "Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  setHeader(event, "ETag", etag);

  return data;
});
