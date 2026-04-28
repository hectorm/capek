import type { JWTPayload } from "jose";
import type { AuthorizationServer, Client, ClientAuth, HttpRequestOptions, IDToken } from "oauth4webapi";
import jmespath from "jmespath";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { useRuntimeConfig } from "nitropack/runtime/config";
import * as oauth from "oauth4webapi";

import { useLogger } from "~~/server/lib/logger";

const config = useRuntimeConfig();
const logger = useLogger();

export interface OIDCOptions {
  rootUrl: string;
  issuer: string;
  discoveryEnabled: boolean;
  discoveryCacheDurationSec: number;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  endSessionEndpoint?: string;
  jwksUri?: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  prompt: string;
  usernameAttributePath: string;
  fullnameAttributePath: string;
  emailAttributePath: string;
  pictureAttributePath: string;
  rolesAttributePath?: string;
  groupsAttributePath?: string;
  allowedPath: string;
  codeVerifierCookieName: string;
  stateCookieName: string;
  nonceCookieName: string;
}

export interface OIDCTokens {
  idToken: string;
  idTokenClaims: IDToken & { sid?: string };
  accessToken: string;
  accessTokenExpiresAt?: Date | null;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: Date | null;
}

export interface OIDCUserProfile {
  preferred_username: string;
  name: string;
  email: string;
  picture?: string;
  roles?: string[];
  groups?: string[];
}

export class OIDC {
  public rootUrl: URL;

  public as: AuthorizationServer;
  public discoveryEnabled: boolean;
  public discoveryCacheDurationSec: number;
  public discoveryCache = new Map<string, { as: AuthorizationServer; expiresAt: number }>();

  public scopes: string;
  public prompt: string;

  public client: Client;
  public clientAuth: ClientAuth;

  public usernameAttributePath: string;
  public fullnameAttributePath: string;
  public emailAttributePath: string;
  public pictureAttributePath: string;
  public rolesAttributePath?: string;
  public groupsAttributePath?: string;
  public allowedPath: string;

  public codeVerifierCookieName: string;
  public stateCookieName: string;
  public nonceCookieName: string;

  public httpRequestOptions: HttpRequestOptions<unknown, unknown>;

  constructor(options: OIDCOptions) {
    this.rootUrl = new URL(options.rootUrl);

    this.as = {
      issuer: options.issuer,
      authorization_endpoint: options.authorizationEndpoint,
      token_endpoint: options.tokenEndpoint,
      userinfo_endpoint: options.userinfoEndpoint,
      end_session_endpoint: options.endSessionEndpoint,
      jwks_uri: options.jwksUri,
    };
    this.discoveryEnabled = options.discoveryEnabled;
    this.discoveryCacheDurationSec = options.discoveryCacheDurationSec;

    this.client = {
      client_id: options.clientId,
      token_endpoint_auth_method: "client_secret_basic",
    };
    this.clientAuth = oauth.ClientSecretPost(options.clientSecret);

    this.scopes = options.scopes;
    this.prompt = options.prompt;

    this.usernameAttributePath = options.usernameAttributePath;
    this.fullnameAttributePath = options.fullnameAttributePath;
    this.emailAttributePath = options.emailAttributePath;
    this.pictureAttributePath = options.pictureAttributePath;
    this.rolesAttributePath = options.rolesAttributePath;
    this.groupsAttributePath = options.groupsAttributePath;
    this.allowedPath = options.allowedPath;

    this.codeVerifierCookieName = options.codeVerifierCookieName;
    this.stateCookieName = options.stateCookieName;
    this.nonceCookieName = options.nonceCookieName;

    this.httpRequestOptions = {};
  }

  get redirectUri(): string {
    return new URL("/api/login/callback", this.rootUrl).toString();
  }

  public async discover(): Promise<void> {
    if (!this.discoveryEnabled) return;

    let as: AuthorizationServer | null = null;
    const issuer = this.as.issuer;

    const now = Date.now();
    const cached = this.discoveryCache.get(issuer);
    if (cached && cached.expiresAt > now) as = cached.as;

    if (!as) {
      logger.debug({ issuer }, "Fetching OIDC discovery document");
      const url = new URL(issuer);
      const response = await oauth.discoveryRequest(url, { algorithm: "oidc" });
      as = await oauth.processDiscoveryResponse(url, response);
      const expiresAt = now + this.discoveryCacheDurationSec * 1000;
      this.discoveryCache.set(issuer, { as, expiresAt });
    }

    this.as = {
      // Merge discovered values with existing ones, giving priority to existing ones
      issuer: this.as.issuer,
      authorization_endpoint: this.as.authorization_endpoint ?? as.authorization_endpoint,
      token_endpoint: this.as.token_endpoint ?? as.token_endpoint,
      userinfo_endpoint: this.as.userinfo_endpoint ?? as.userinfo_endpoint,
      end_session_endpoint: this.as.end_session_endpoint ?? as.end_session_endpoint,
      jwks_uri: this.as.jwks_uri ?? as.jwks_uri,
    };
  }

  public async createAuthorizationUrl(codeVerifier: string, state: string, nonce: string): Promise<URL> {
    await this.discover();

    if (!this.as.authorization_endpoint) {
      throw new Error("Authorization endpoint not available");
    }

    const url = new URL(this.as.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.client.client_id);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("scope", this.scopes);
    url.searchParams.set("prompt", this.prompt);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(codeVerifier));
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);

    return url;
  }

  public async validateAuthorizationCallback(
    callbackUrl: URL,
    codeVerifier: string,
    state: string,
    nonce: string,
  ): Promise<OIDCTokens> {
    await this.discover();

    const params = oauth.validateAuthResponse(this.as, this.client, callbackUrl, state);

    const response = await oauth.authorizationCodeGrantRequest(
      this.as,
      this.client,
      this.clientAuth,
      params,
      this.redirectUri,
      codeVerifier,
      this.httpRequestOptions,
    );

    const result = await oauth.processAuthorizationCodeResponse(this.as, this.client, response, {
      expectedNonce: nonce,
      requireIdToken: true,
    });

    if (!result.id_token) {
      throw new Error("ID token not received");
    }

    const idTokenClaims = oauth.getValidatedIdTokenClaims(result);

    if (!idTokenClaims) {
      throw new Error("ID token claims validation failed");
    }

    const tokens: OIDCTokens = {
      idToken: result.id_token,
      idTokenClaims,
      accessToken: result.access_token,
      accessTokenExpiresAt: this.expiresAt(result.expires_in),
      refreshToken: result.refresh_token ?? null,
      refreshTokenExpiresAt: this.expiresAt(result.refresh_expires_in),
    };

    return tokens;
  }

  public async refreshAccessToken(refreshToken: string): Promise<Omit<OIDCTokens, "idToken" | "idTokenClaims">> {
    await this.discover();

    const response = await oauth.refreshTokenGrantRequest(
      this.as,
      this.client,
      this.clientAuth,
      refreshToken,
      this.httpRequestOptions,
    );

    const result = await oauth.processRefreshTokenResponse(this.as, this.client, response);

    const tokens = {
      accessToken: result.access_token,
      accessTokenExpiresAt: this.expiresAt(result.expires_in),
      refreshToken: result.refresh_token ?? null,
      refreshTokenExpiresAt: this.expiresAt(result.refresh_expires_in),
    };

    return tokens;
  }

  public async getUserProfile(idTokenClaims: IDToken, accessToken: string): Promise<OIDCUserProfile | null> {
    const profile: Partial<OIDCUserProfile> = {};

    if (jmespath.search(idTokenClaims, this.allowedPath) === true) {
      const username: unknown = jmespath.search(idTokenClaims, this.usernameAttributePath);
      const name: unknown = jmespath.search(idTokenClaims, this.fullnameAttributePath);
      const email: unknown = jmespath.search(idTokenClaims, this.emailAttributePath);
      const picture: unknown = jmespath.search(idTokenClaims, this.pictureAttributePath);
      profile.preferred_username = (typeof username === "string" ? username : undefined) ?? "";
      profile.name = (typeof name === "string" ? name : undefined) ?? "";
      profile.email = (typeof email === "string" ? email : undefined) ?? "";
      profile.picture = typeof picture === "string" ? picture : undefined;
      if (this.rolesAttributePath) {
        const roles: unknown = jmespath.search(idTokenClaims, this.rolesAttributePath);
        if (Array.isArray(roles)) {
          const filteredRoles = roles.filter((r): r is string => typeof r === "string");
          profile.roles = filteredRoles.length > 0 ? filteredRoles : undefined;
        }
      }
      if (this.groupsAttributePath) {
        const groups: unknown = jmespath.search(idTokenClaims, this.groupsAttributePath);
        if (Array.isArray(groups)) {
          const filteredGroups = groups.filter((g): g is string => typeof g === "string");
          profile.groups = filteredGroups.length > 0 ? filteredGroups : undefined;
        }
      }
    } else {
      logger.debug({ idTokenClaims }, "ID token claims do not match the allowed path");
    }

    if (Object.keys(profile).length === 0 || Object.values(profile).some((x) => !x)) {
      await this.discover();

      if (this.as.userinfo_endpoint) {
        const userInfoResponse = await oauth.userInfoRequest(
          this.as,
          this.client,
          accessToken,
          this.httpRequestOptions,
        );
        const userInfo = await oauth.processUserInfoResponse(this.as, this.client, idTokenClaims.sub, userInfoResponse);

        if (jmespath.search(userInfo, this.allowedPath) === true) {
          const username: unknown = jmespath.search(userInfo, this.usernameAttributePath);
          const name: unknown = jmespath.search(userInfo, this.fullnameAttributePath);
          const email: unknown = jmespath.search(userInfo, this.emailAttributePath);
          const picture: unknown = jmespath.search(userInfo, this.pictureAttributePath);
          profile.preferred_username ??= (typeof username === "string" ? username : undefined) ?? "";
          profile.name ??= (typeof name === "string" ? name : undefined) ?? "";
          profile.email ??= (typeof email === "string" ? email : undefined) ?? "";
          profile.picture ??= typeof picture === "string" ? picture : undefined;
          if (this.rolesAttributePath) {
            const roles: unknown = jmespath.search(userInfo, this.rolesAttributePath);
            if (Array.isArray(roles)) {
              const filteredRoles = roles.filter((r): r is string => typeof r === "string");
              profile.roles ??= filteredRoles.length > 0 ? filteredRoles : undefined;
            }
          }
          if (this.groupsAttributePath) {
            const groups: unknown = jmespath.search(userInfo, this.groupsAttributePath);
            if (Array.isArray(groups)) {
              const filteredGroups = groups.filter((g): g is string => typeof g === "string");
              profile.groups ??= filteredGroups.length > 0 ? filteredGroups : undefined;
            }
          }
        } else {
          logger.debug({ userInfo }, "UserInfo response do not match the allowed path");
        }

        if (Object.keys(profile).length === 0 || Object.values(profile).some((x) => !x)) {
          logger.debug({ profile }, "User profile is incomplete");
        }
      } else {
        logger.debug({ profile }, "User profile is incomplete and no UserInfo endpoint is configured");
        return null;
      }
    }

    if (typeof profile.roles === "string") {
      profile.roles = [profile.roles];
    }

    if (typeof profile.groups === "string") {
      profile.groups = [profile.groups];
    }

    if (!profile.preferred_username || !profile.name || !profile.email) {
      logger.warn({ profile }, "User profile is missing required fields (preferred_username, name or email)");
      return null;
    }

    return profile as OIDCUserProfile;
  }

  public async createEndSessionUrl(idToken?: string | null): Promise<URL | null> {
    await this.discover();

    if (!this.as.end_session_endpoint) {
      return null;
    }

    const url = new URL(this.as.end_session_endpoint);
    url.searchParams.set("client_id", this.client.client_id);
    url.searchParams.set("post_logout_redirect_uri", this.rootUrl.toString());
    if (typeof idToken === "string") url.searchParams.set("id_token_hint", idToken);

    return url;
  }

  public async validateBackchannelLogoutToken(logoutToken: string): Promise<JWTPayload> {
    await this.discover();

    if (!this.as.jwks_uri) {
      throw new Error("JWKS URI not available");
    }

    const JWKS = createRemoteJWKSet(new URL(this.as.jwks_uri));
    const { payload } = await jwtVerify(logoutToken, JWKS, {
      issuer: this.as.issuer,
      audience: this.client.client_id,
      maxTokenAge: "2 minutes",
      // TODO: Keycloak uses a too generic type, revisit this later
      // See: https://github.com/keycloak/keycloak/issues/19220
      // typ: "logout+jwt",
    });

    if (!payload.sid && !payload.sub) {
      throw new Error("Logout token must contain either sub claim or sid claim, or both");
    }

    if (!(payload.events as Record<string, unknown>)["http://schemas.openid.net/event/backchannel-logout"]) {
      throw new Error("Logout token must contain events claim with correct schema");
    }

    if (payload.nonce) {
      throw new Error("Logout token must not contain nonce claim");
    }

    return payload;
  }

  public generateCodeVerifier(): string {
    return oauth.generateRandomCodeVerifier();
  }

  public generateState(data?: Record<string, unknown>): string {
    const bytes = crypto.getRandomValues(new Uint32Array(4));
    const state = [data, ...bytes];
    return btoa(JSON.stringify(state)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  public parseState(state: string): Record<string, unknown> | null {
    try {
      const decoded: unknown = JSON.parse(atob(state.replace(/-/g, "+").replace(/_/g, "/")));
      return Array.isArray(decoded) && decoded.length > 0 && typeof decoded[0] === "object" && decoded[0] !== null
        ? (decoded[0] as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  public generateNonce(): string {
    return oauth.generateRandomNonce();
  }

  private expiresAt(expiresIn: unknown): Date | null {
    return typeof expiresIn === "number" ? new Date(Date.now() + expiresIn * 1000) : null;
  }
}

let oidcInstance: OIDC | null = null;

export const useOIDC = (): OIDC => {
  oidcInstance ??= new OIDC(config.oidc);
  return oidcInstance;
};
