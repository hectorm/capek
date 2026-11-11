import { describe, expect, it } from "vitest";

import { describeError } from "#layers/ai/server/lib/errors";

describe("errors", () => {
  it("describes an error with the reason that caused it", () => {
    const refused = new Error("connect ECONNREFUSED 127.0.0.1:8080");
    const refusedToo = new Error("connect ECONNREFUSED ::1:8080");

    expect(describeError(new Error("fetch failed"))).toBe("fetch failed");
    expect(describeError(new TypeError("fetch failed", { cause: refused }))).toBe(
      "fetch failed: connect ECONNREFUSED 127.0.0.1:8080",
    );
    expect(describeError(new TypeError("fetch failed", { cause: new AggregateError([refusedToo, refused]) }))).toBe(
      "fetch failed: connect ECONNREFUSED ::1:8080, connect ECONNREFUSED 127.0.0.1:8080",
    );
    expect(describeError("timeout")).toBe("timeout");
  });
});
