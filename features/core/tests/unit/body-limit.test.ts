import type { H3Event } from "h3";
import { describe, expect, it } from "vitest";

import { collectBodyLimits, DEFAULT_BODY_LIMIT, resolveBodyLimit } from "#layers/core/server/lib/body-limit";

const request = (path: string): H3Event => ({ path }) as H3Event;

describe("request body limit", () => {
  const limits = collectBodyLimits([
    { name: "core" },
    {
      name: "files",
      bodyLimits: {
        "/api/files/upload": 100,
        "/api/files/import": () => Promise.resolve(200),
        "/api/files/restore": () => Number.NaN,
      },
    },
  ]);

  it("is the default one for the routes without a valid limit of their own", async () => {
    await expect(resolveBodyLimit(limits, request("/api/trpc/user.read"))).resolves.toBe(DEFAULT_BODY_LIMIT);
    await expect(resolveBodyLimit(limits, request("/api/files/upload/"))).resolves.toBe(DEFAULT_BODY_LIMIT);
    await expect(resolveBodyLimit(limits, request("/api/files/restore"))).resolves.toBe(DEFAULT_BODY_LIMIT);
  });

  it("is the one that a feature sets for its route", async () => {
    await expect(resolveBodyLimit(limits, request("/api/files/upload"))).resolves.toBe(100);
    await expect(resolveBodyLimit(limits, request("/api/files/upload?overwrite=1"))).resolves.toBe(100);
    await expect(resolveBodyLimit(limits, request("/api/files/import"))).resolves.toBe(200);
  });

  it("is only set by a feature for its own routes", () => {
    expect(() => collectBodyLimits([{ name: "files", bodyLimits: { "/api/ai/chat/send": 100 } }])).toThrow(
      /Route "\/api\/ai\/chat\/send" of feature "files" must start with "\/api\/files\/"/,
    );
    expect(() => {
      return collectBodyLimits([
        { name: "core", bodyLimits: { "/api/files/upload": 100 } },
        { name: "files", bodyLimits: { "/api/files/upload": 200 } },
      ]);
    }).toThrow(/Duplicate body limit of route "\/api\/files\/upload" in feature "files"/);
  });
});
