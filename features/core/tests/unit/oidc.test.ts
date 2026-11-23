import type { IDToken } from "oauth4webapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OIDC } from "#layers/core/server/lib/authn/oidc";

const oidc = new OIDC({
  rootUrl: "http://localhost:3000",
  issuer: "https://idp.localhost",
  discoveryCacheDurationSec: 3600,
  authorizationEndpoint: "https://idp.localhost/authorize",
  tokenEndpoint: "https://idp.localhost/token",
  userinfoEndpoint: "https://idp.localhost/userinfo",
  jwksUri: "https://idp.localhost/jwks",
  clientId: "client",
  clientSecret: "secret",
  scopes: "openid profile email",
  prompt: "select_account",
  usernameAttributePath: "preferred_username || email",
  fullnameAttributePath: "name || preferred_username",
  emailAttributePath: "email",
  emailVerifiedAttributePath: "email_verified || xms_edov",
  pictureAttributePath: "picture",
  rolesAttributePath: "(type(roles) == 'array' && roles) || `[\"member\"]`",
  groupsAttributePath: "(type(groups) == 'array' && groups) || `[]`",
  allowedPath: "email_verified == `true` || xms_edov == `true`",
  codeVerifierCookieName: "oidc_code_verifier",
  stateCookieName: "oidc_state",
  nonceCookieName: "oidc_nonce",
});

const answerUserInfo = (userInfo: Record<string, unknown>): void => {
  vi.stubGlobal("fetch", () => {
    return Promise.resolve(new Response(JSON.stringify(userInfo), { headers: { "Content-Type": "application/json" } }));
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const claims = (extra: Record<string, unknown>): IDToken => {
  return {
    sub: "alice",
    preferred_username: "alice",
    name: "Alice",
    email: "alice@example.com",
    email_verified: true,
    picture: "https://idp.localhost/alice.png",
    ...extra,
  } as unknown as IDToken;
};

describe("OIDC user profile", () => {
  it("takes the roles and groups of the claims", async () => {
    const profile = await oidc.findUserProfile(claims({ roles: ["admin"], groups: ["finance"] }), "token");
    expect(profile).toMatchObject({ roles: ["admin"], groups: ["finance"] });
  });

  it("makes members of the users without roles", async () => {
    const profile = await oidc.findUserProfile(claims({ groups: ["finance"] }), "token");
    expect(profile?.roles).toEqual(["member"]);
  });

  it("gives no groups to the users without groups", async () => {
    const withoutGroups = claims({ roles: ["admin"], groups: [] });
    answerUserInfo(withoutGroups);
    const profile = await oidc.findUserProfile(withoutGroups, "token");
    expect(profile).toMatchObject({ roles: ["admin"], groups: [] });
  });

  it("takes the claims missing from the ID token from the UserInfo endpoint", async () => {
    answerUserInfo(claims({}));
    const profile = await oidc.findUserProfile(claims({ email: undefined }), "token");
    expect(profile?.email).toBe("alice@example.com");
  });

  it("keeps the claims of the ID token when the UserInfo endpoint fails", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 500 })));
    const profile = await oidc.findUserProfile(claims({ picture: undefined }), "token");
    expect(profile).toMatchObject({ preferred_username: "alice", email: "alice@example.com", roles: ["member"] });
  });

  it("rejects the users whose email is not verified", async () => {
    const unverified = claims({ email_verified: false });
    answerUserInfo(unverified);
    expect(await oidc.findUserProfile(unverified, "token")).toBeNull();
  });

  it("lowercases the email", async () => {
    const profile = await oidc.findUserProfile(claims({ email: "Alice@Example.com" }), "token");
    expect(profile?.email).toBe("alice@example.com");

    answerUserInfo(claims({ email: "Alice@Example.com" }));
    const fromUserInfo = await oidc.findUserProfile(claims({ email: undefined }), "token");
    expect(fromUserInfo?.email).toBe("alice@example.com");
  });
});
