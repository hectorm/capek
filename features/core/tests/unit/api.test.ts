import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Kysely } from "kysely";
import { createApp, eventHandler, toNodeListener } from "h3";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import backchannelLogout from "#layers/core/server/api/logout/backchannel.post";
import logout from "#layers/core/server/api/logout/index.get";
import { useSessions } from "#layers/core/server/lib/authn/sessions";
import authn from "#layers/core/server/middleware/authn";
import { closeDb, createTestDb, insertUsers } from "#layers/core/tests/unit/helpers/db";
import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";

let db: Kysely<Database>;
let server: Server;
let baseUrl: string;

const alice = crypto.randomUUID();
const provider = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(provider.publicKey)), kid: "key", alg: "ES256" };

beforeAll(async () => {
  db = await createTestDb();
  await insertUsers(db, { alice });

  const app = createApp();
  app.use(authn);
  app.use(
    "/jwks",
    eventHandler(() => ({ keys: [jwk] })),
  );
  app.use("/api/logout/backchannel", backchannelLogout);
  app.use("/api/logout", logout);
  app.use(
    "/api/me",
    eventHandler((event) => {
      const user = event.context.user;
      return user ? { username: user.username, fullname: user.fullname, email: user.email } : {};
    }),
  );
  server = createServer(toNodeListener(app)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  Object.assign(runtimeConfig, {
    session: { cookieName: "session", durationSec: 3600, maxDurationSec: 86400 },
    proxy: {
      secret: "proxy-secret",
      secretHeader: "X-Proxy-Secret",
      headerUsername: "X-Forwarded-User",
      headerFullname: "X-Forwarded-Preferred-Username",
      headerEmail: "X-Forwarded-Email",
      headerPicture: "X-Forwarded-Picture",
      headerRoles: "X-Forwarded-Roles",
      headerGroups: "X-Forwarded-Groups",
      syncRoles: false,
      syncGroups: false,
      cacheTtlSec: 0,
    },
    oidc: {
      rootUrl: "http://localhost:3000",
      issuer: "https://idp.localhost",
      discoveryCacheDurationSec: 3600,
      authorizationEndpoint: "https://idp.localhost/authorize",
      tokenEndpoint: "https://idp.localhost/token",
      userinfoEndpoint: "",
      endSessionEndpoint: "",
      jwksUri: `${baseUrl}/jwks`,
      clientId: "capek",
      clientSecret: "secret",
      scopes: "openid",
      prompt: "",
      usernameAttributePath: "preferred_username",
      fullnameAttributePath: "name",
      emailAttributePath: "email",
      emailVerifiedAttributePath: "email_verified",
      pictureAttributePath: "picture",
      allowedPath: "`true`",
      codeVerifierCookieName: "oidc_code_verifier",
      stateCookieName: "oidc_state",
      nonceCookieName: "oidc_nonce",
    },
  });
});

afterAll(async () => {
  server.close();
  await closeDb();
});

const request = (path: string, init: RequestInit = {}): Promise<Response> => {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...init });
};

// Proxies send UTF-8, which the headers of a request carry as one character per byte
const utf8 = (value: string): string => Buffer.from(value, "utf8").toString("latin1");

describe("proxy authentication", () => {
  const headers = {
    "X-Proxy-Secret": "proxy-secret",
    "X-Forwarded-User": "bob",
    "X-Forwarded-Preferred-Username": utf8("Bob Müller"),
    "X-Forwarded-Email": "Bob@Example.com",
    "X-Forwarded-Roles": "admin",
  };

  beforeAll(async () => {
    runtimeConfig.authMode = "proxy";
    await db.insertInto("roles").values({ name: "admin" }).execute();
  });

  const roles = (username: string) => {
    return db
      .selectFrom("userRoles")
      .innerJoin("users", "users.id", "userRoles.userId")
      .innerJoin("roles", "roles.id", "userRoles.roleId")
      .select(["roles.name"])
      .where("users.username", "=", username)
      .execute();
  };

  it("takes the user from the headers of a request with the secret", async () => {
    const response = await request("/api/me", { headers });
    expect(await response.json()).toEqual({ username: "bob", fullname: "Bob Müller", email: "bob@example.com" });

    const forged = await request("/api/me", { headers: { ...headers, "X-Proxy-Secret": "guess" } });
    expect(await forged.json()).toEqual({});
  });

  it("only takes the roles from the headers when their sync is enabled", async () => {
    await request("/api/me", { headers });
    expect(await roles("bob")).toEqual([]);

    (runtimeConfig.proxy as { syncRoles: boolean }).syncRoles = true;
    await request("/api/me", { headers });
    expect(await roles("bob")).toEqual([{ name: "admin" }]);
  });

  it("rejects the writes from other sites", async () => {
    const post = (site: string) => request("/api/me", { method: "POST", headers: { "Sec-Fetch-Site": site } });
    expect((await post("cross-site")).status).toBe(403);
    expect((await post("same-origin")).status).toBe(200);
  });
});

describe("OIDC logout", () => {
  beforeAll(() => {
    runtimeConfig.authMode = "oidc";
  });

  const sessionIds = async (): Promise<(string | null)[]> => {
    const rows = await db.selectFrom("sessions").select(["sid"]).orderBy("sid").execute();
    return rows.map((row) => row.sid);
  };

  it("ends the session of the user", async () => {
    const session = await useSessions().createSession(alice);

    const response = await request("/api/logout", { headers: { Cookie: `session=${session.token}` } });
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("session=; Path=/; Max-Age=0");
    expect(await sessionIds()).toEqual([]);
  });

  it("ends the sessions that the provider logs out", async () => {
    await useSessions().createSession(alice, "sid-1");
    await useSessions().createSession(alice, "sid-1");
    await useSessions().createSession(alice, "sid-2");

    const logoutToken = (key: CryptoKey): Promise<string> => {
      return new SignJWT({ sid: "sid-1", events: { "http://schemas.openid.net/event/backchannel-logout": {} } })
        .setProtectedHeader({ alg: "ES256", kid: "key" })
        .setIssuer("https://idp.localhost")
        .setAudience("capek")
        .setIssuedAt()
        .setJti(crypto.randomUUID())
        .sign(key);
    };
    const backchannel = async (token: string): Promise<number> => {
      const body = new URLSearchParams({ logout_token: token });
      return (await request("/api/logout/backchannel", { method: "POST", body })).status;
    };

    const stranger = await generateKeyPair("ES256");
    expect(await backchannel(await logoutToken(stranger.privateKey))).toBe(400);
    expect(await sessionIds()).toEqual(["sid-1", "sid-1", "sid-2"]);

    expect(await backchannel(await logoutToken(provider.privateKey))).toBe(204);
    expect(await sessionIds()).toEqual(["sid-2"]);
  });
});
