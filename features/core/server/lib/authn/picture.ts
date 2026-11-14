import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { fetchEndpoint } from "#layers/core/server/lib/http";

const PICTURE_MAX_BYTES = 1024 * 1024;
const PICTURE_TIMEOUT_MS = 10_000;

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/webp", "image/jpeg", "image/jxl", "image/avif", "image/gif"]);

export interface UserPicture {
  mimeType: string;
  data: Buffer;
}

export const userPicturePath = (url: string | null): string | null => {
  if (!url || !URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    return null;
  }
  return `/api/user/picture?v=${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
};

export const fetchUserPicture = async (url: string): Promise<UserPicture> => {
  const response = await fetchEndpoint(url, { signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS) });

  const mimeType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!response.ok || !ALLOWED_MIME_TYPES.has(mimeType)) {
    await response.body?.cancel();
    throw new Error("The picture is not an image");
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength;
    if (bytes > PICTURE_MAX_BYTES) {
      throw new Error("The picture is too large");
    }
    chunks.push(chunk);
  }

  return { mimeType, data: Buffer.concat(chunks) };
};
