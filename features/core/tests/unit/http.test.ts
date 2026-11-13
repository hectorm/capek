import { describe, expect, it } from "vitest";

import type { Endpoint } from "#layers/core/server/lib/http";
import { unredactEndpoint } from "#layers/core/server/lib/http";
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
