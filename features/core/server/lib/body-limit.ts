import type { H3Event } from "h3";

import type { ServerFeature } from "#layers/core/server/lib/features/define";

export const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;

// Body limit of a route in bytes
export type BodyLimit = number | ((event: H3Event) => number | Promise<number>);

export type BodyLimits = Readonly<Record<string, BodyLimit>>;

// Non-core features can override body limits only under /api/<feature>/
export const collectBodyLimits = (features: readonly ServerFeature[]): ReadonlyMap<string, BodyLimit> => {
  const limits = new Map<string, BodyLimit>();
  for (const feature of features) {
    for (const [path, limit] of Object.entries(feature.bodyLimits ?? {})) {
      if (feature.name !== "core" && !path.startsWith(`/api/${feature.name}/`)) {
        throw new Error(`Route "${path}" of feature "${feature.name}" must start with "/api/${feature.name}/"`);
      }
      if (limits.has(path)) {
        throw new Error(`Duplicate body limit of route "${path}" in feature "${feature.name}"`);
      }
      limits.set(path, limit);
    }
  }
  return limits;
};

// Only an exact route match gets a custom body limit
export const resolveBodyLimit = async (limits: ReadonlyMap<string, BodyLimit>, event: H3Event): Promise<number> => {
  const limit = limits.get(event.path.split("?", 1)[0] ?? "");
  const bytes = typeof limit === "function" ? await limit(event) : limit;
  return bytes !== undefined && Number.isFinite(bytes) ? bytes : DEFAULT_BODY_LIMIT;
};
