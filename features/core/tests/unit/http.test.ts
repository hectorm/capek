import { describe, expect, it } from "vitest";

import type { Endpoint } from "#layers/core/server/lib/http";
import { readErrorMessage, unredactEndpoint } from "#layers/core/server/lib/http";
import { HttpRedactedValue } from "#layers/core/shared/http";

const stored: Endpoint = {
  url: "https://api.example.com/v1",
  apiKey: "stored-key",
  headers: [{ name: "X-Token", value: "stored-token" }],
};

const hiddenHeaders = [{ name: "X-Token", value: HttpRedactedValue }];

describe("endpoint secret", () => {
  it("is taken from the stored endpoint when missing or hidden", () => {
    expect(unredactEndpoint({}, stored)).toEqual(stored);
    expect(unredactEndpoint({ url: stored.url, apiKey: HttpRedactedValue, headers: hiddenHeaders }, stored)).toEqual(
      stored,
    );
    expect(unredactEndpoint({ apiKey: "typed-key", headers: [] }, stored)).toEqual({
      url: stored.url,
      apiKey: "typed-key",
      headers: [],
    });
  });

  it("is not sent to another URL", () => {
    const url = "https://attacker.example/v1";

    const sentWithStoredSecrets = [
      { url },
      { url, apiKey: "typed-key" },
      { url, apiKey: "typed-key", headers: hiddenHeaders },
      { url, apiKey: HttpRedactedValue, headers: [] },
    ];
    for (const sent of sentWithStoredSecrets) {
      expect(() => unredactEndpoint(sent, stored)).toThrow(/have to be entered again/);
    }

    const headers = [{ name: "X-Token", value: "typed-token" }];
    expect(unredactEndpoint({ url, apiKey: "typed-key", headers }, stored)).toEqual({
      url,
      apiKey: "typed-key",
      headers,
    });
  });

  it("is not needed to move an endpoint without secrets", () => {
    const url = "https://other.example/v1";

    expect(unredactEndpoint({ url }, { url: stored.url, apiKey: "", headers: [] })).toEqual({
      url,
      apiKey: "",
      headers: [],
    });
  });

  it("is left empty when hidden and not stored", () => {
    const url = "https://other.example/v1";

    expect(unredactEndpoint({ url, apiKey: HttpRedactedValue, headers: hiddenHeaders }, undefined)).toEqual({
      url,
      apiKey: "",
      headers: [{ name: "X-Token", value: "" }],
    });
  });
});

describe("failed response", () => {
  const describeFailure = (body: string, status: number) => readErrorMessage(new Response(body, { status }));

  it("is described by the message of an API error", async () => {
    const bodies = [
      { error: { message: "No such model", type: "invalid_request_error" } },
      { error: "No such model" },
      { message: "No such model" },
      { detail: "No such model" },
    ];
    for (const body of bodies) {
      expect(await describeFailure(JSON.stringify(body), 404)).toBe("404 Not Found: No such model");
    }

    const long = JSON.stringify({ error: { message: "x".repeat(2000) } });
    expect(await describeFailure(long, 400)).toBe(`400 Bad Request: ${"x".repeat(1000)}...`);
  });

  it("is described only by its status when the body is not an API error", async () => {
    const bodies = ["", "internal secret", '{"token":"internal secret"}', '{"error":{"message":" "}}'];
    for (const body of bodies) {
      expect(await describeFailure(body, 403)).toBe("403 Forbidden");
    }
  });
});
