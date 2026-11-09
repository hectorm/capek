import { describe, expect, it } from "vitest";

import { composeCsp } from "#layers/core/server/lib/csp";

const base = {
  "default-src": ["'self'"],
  "img-src": ["'self'", "data:"],
};

describe("content security policy", () => {
  it("keeps the base policy without contributions", () => {
    expect(composeCsp(base, [])).toBe("default-src 'self'; img-src 'self' data:");
  });

  it("adds the sources of the features to their directives", () => {
    const policy = composeCsp(base, [
      { "frame-src": ["https://example.com"], "img-src": ["https://cdn.example.com"] },
      { "frame-src": ["https://reports.example.com", "https://example.com"] },
    ]);
    expect(policy).toBe(
      [
        "default-src 'self'",
        "img-src 'self' data: https://cdn.example.com",
        // Starts from the sources of "default-src", which the directive no longer falls back to
        "frame-src 'self' https://example.com https://reports.example.com",
      ].join("; "),
    );
  });

  it("rejects sources that would change other parts of the policy", () => {
    expect(() => composeCsp(base, [{ "frame-src": ["https://a.example.com; script-src *"] }])).toThrow(
      /Invalid Content Security Policy source/,
    );
    expect(() => composeCsp(base, [{ "frame-src; script-src": ["*"] }])).toThrow(
      /Invalid Content Security Policy directive/,
    );
  });
});
