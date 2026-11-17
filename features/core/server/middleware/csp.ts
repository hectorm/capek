import { randomBytes } from "node:crypto";

import { defineEventHandler, setResponseHeader } from "h3";

import type { CspSources } from "#layers/core/server/lib/csp";
import { assertCspSources, composeCsp } from "#layers/core/server/lib/csp";
import { getServerFeatures } from "#layers/core/server/lib/features";
import { useLogger } from "#layers/core/server/lib/logger";

declare module "h3" {
  interface H3EventContext {
    nonce: string;
  }
}

const logger = useLogger();

const baseSources = (nonce: string): CspSources => ({
  "default-src": ["'self'"],
  "script-src": [`'nonce-${nonce}'`, "'strict-dynamic'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "blob:", "data:"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'self'"],
  "object-src": ["'none'"],
});

export default defineEventHandler(async (event) => {
  const nonce = randomBytes(16).toString("base64");
  event.context.nonce = nonce;

  // A failed lookup contributes no sources to the policy
  const contributions: CspSources[] = [];
  for (const { name, csp } of getServerFeatures()) {
    if (csp) {
      try {
        const sources = typeof csp === "function" ? await csp(event) : csp;
        assertCspSources(sources);
        contributions.push(sources);
      } catch (error) {
        logger.error({ feature: name, error }, "Content Security Policy sources of the feature could not be added");
      }
    }
  }

  setResponseHeader(event, "Content-Security-Policy", composeCsp(baseSources(nonce), contributions));
});
