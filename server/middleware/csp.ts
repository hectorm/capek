import { randomBytes } from "node:crypto";

import { defineEventHandler, setResponseHeader } from "h3";

declare module "h3" {
  interface H3EventContext {
    nonce: string;
  }
}

export default defineEventHandler((event) => {
  const nonce = randomBytes(16).toString("base64");
  event.context.nonce = nonce;

  setResponseHeader(
    event,
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
    ].join("; "),
  );
});
