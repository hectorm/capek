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

describe("endpoint secrets", () => {
  it("takes what was not sent, and what was left hidden, from the stored endpoint", () => {
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

  it("does not send the stored secrets to another URL", () => {
    const url = "https://attacker.example/v1";

    expect(() => unredactEndpoint({ url }, stored)).toThrow(/have to be entered again/);
    expect(() => unredactEndpoint({ url, apiKey: "typed-key" }, stored)).toThrow(/have to be entered again/);
    expect(() => unredactEndpoint({ url, apiKey: "typed-key", headers: hiddenHeaders }, stored)).toThrow(
      /have to be entered again/,
    );
    expect(() => unredactEndpoint({ url, apiKey: HttpRedactedValue, headers: [] }, stored)).toThrow(
      /have to be entered again/,
    );

    const headers = [{ name: "X-Token", value: "typed-token" }];
    expect(unredactEndpoint({ url, apiKey: "typed-key", headers }, stored)).toEqual({
      url,
      apiKey: "typed-key",
      headers,
    });
  });

  it("moves the endpoints that have no secrets, and leaves empty the hidden ones that are not stored", () => {
    const url = "https://other.example/v1";

    expect(unredactEndpoint({ url }, { url: stored.url, apiKey: "", headers: [] })).toEqual({
      url,
      apiKey: "",
      headers: [],
    });
    expect(unredactEndpoint({ url, apiKey: HttpRedactedValue, headers: hiddenHeaders }, undefined)).toEqual({
      url,
      apiKey: "",
      headers: [{ name: "X-Token", value: "" }],
    });
  });
});
