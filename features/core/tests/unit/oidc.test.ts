import type { IDToken } from "oauth4webapi";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
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
  clientId: "capek",
  clientSecret: "secret",
  scopes: "openid profile email",
  prompt: "select_account",
  usernameAttributePath: "preferred_username || email",
  fullnameAttributePath: "name || preferred_username",
  emailAttributePath: "email",
  pictureAttributePath: "picture",
  rolesAttributePath: "(type(roles) == 'array' && roles) || `[\"member\"]`",
  groupsAttributePath: "(type(groups) == 'array' && groups) || `[]`",
  allowedPath: "email_verified == `true`",
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

describe("oidc user profile", () => {
  it("takes the roles and groups of the claims", async () => {
    const profile = await oidc.getUserProfile(claims({ roles: ["admin"], groups: ["finance"] }), "token");
    expect(profile).toMatchObject({ roles: ["admin"], groups: ["finance"] });
  });

  it("makes members of the users without roles", async () => {
    const profile = await oidc.getUserProfile(claims({ groups: ["finance"] }), "token");
    expect(profile?.roles).toEqual(["member"]);
  });

  it("leaves the users that come without groups in none, so they are removed from the ones they were in", async () => {
    const withoutGroups = claims({ roles: ["admin"], groups: [] });
    answerUserInfo(withoutGroups);
    const profile = await oidc.getUserProfile(withoutGroups, "token");
    expect(profile).toMatchObject({ roles: ["admin"], groups: [] });
  });

  it("takes the claims missing from the ID token from the UserInfo endpoint", async () => {
    answerUserInfo(claims({}));
    const profile = await oidc.getUserProfile(claims({ email: undefined }), "token");
    expect(profile?.email).toBe("alice@example.com");
  });

  it("keeps the claims of the ID token when the UserInfo endpoint fails", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 500 })));
    const profile = await oidc.getUserProfile(claims({ picture: undefined }), "token");
    expect(profile).toMatchObject({ preferred_username: "alice", email: "alice@example.com", roles: ["member"] });

    // Unless the users are not allowed by them
    expect(await oidc.getUserProfile(claims({ email_verified: false }), "token")).toBeNull();
  });

  it("rejects the users whose email is not verified", async () => {
    const unverified = claims({ email_verified: false });
    answerUserInfo(unverified);
    expect(await oidc.getUserProfile(unverified, "token")).toBeNull();
  });
});

describe("oidc back-channel logout", () => {
  it("checks the logout tokens with the keys of the provider", async () => {
    const provider = await generateKeyPair("ES256");
    const stranger = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(provider.publicKey)), kid: "key", alg: "ES256" };
    const fetchKeys = vi.fn(() => Promise.resolve(Response.json({ keys: [jwk] })));
    vi.stubGlobal("fetch", fetchKeys);

    const logoutToken = (key: CryptoKey): Promise<string> => {
      return new SignJWT({ sid: "session", events: { "http://schemas.openid.net/event/backchannel-logout": {} } })
        .setProtectedHeader({ alg: "ES256", kid: "key" })
        .setIssuer("https://idp.localhost")
        .setAudience("capek")
        .setIssuedAt()
        .setJti(crypto.randomUUID())
        .sign(key);
    };

    expect(await oidc.validateBackchannelLogoutToken(await logoutToken(provider.privateKey))).toMatchObject({
      sid: "session",
    });
    await expect(oidc.validateBackchannelLogoutToken(await logoutToken(stranger.privateKey))).rejects.toThrow();
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });
});
