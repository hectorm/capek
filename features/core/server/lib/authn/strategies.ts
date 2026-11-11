import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import type { H3Event } from "h3";
import { appendHeader, getCookie, getHeader } from "h3";
import { sql } from "kysely";
import { useRuntimeConfig } from "nitropack/runtime/config";

import type { User } from "#layers/core/shared/schema";
import { useLucia } from "#layers/core/server/lib/authn/lucia";
import { getOrCreateUserFromProxy, syncUserGroups, syncUserRoles } from "#layers/core/server/lib/authn/sync";
import { useDb } from "#layers/core/server/lib/database";
import { useLogger } from "#layers/core/server/lib/logger";
import { Roles } from "#layers/core/shared/rbac";

const config = useRuntimeConfig();
const logger = useLogger();

export const AuthModes = {
  OIDC: "oidc",
  Proxy: "proxy",
  SingleUser: "single-user",
} as const;

export interface AuthStrategy {
  getUserFromEvent(event: H3Event): Promise<AuthUser | null>;
}

export interface AuthUser extends User {
  groups: string[];
  permissions: string[];
}

export const getUserAuthContext = async (userId: string): Promise<Pick<AuthUser, "groups" | "permissions">> => {
  const db = await useDb();

  const result = await sql<{ groups: string[]; permissions: string[] }>`
    WITH user_permissions AS (
      SELECT p.name
      FROM permissions p
      INNER JOIN role_permissions rp ON rp.permission_id = p.id
      INNER JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ${userId}
      UNION
      SELECT p.name
      FROM permissions p
      INNER JOIN role_permissions rp ON rp.permission_id = p.id
      INNER JOIN group_roles gr ON gr.role_id = rp.role_id
      INNER JOIN user_groups ug ON ug.group_id = gr.group_id
      WHERE ug.user_id = ${userId}
    ),
    user_group_ids AS (
      SELECT ug.group_id
      FROM user_groups ug
      WHERE ug.user_id = ${userId}
    )
    SELECT
      COALESCE(ARRAY_AGG(DISTINCT up.name), '{}') AS permissions,
      COALESCE((SELECT ARRAY_AGG(ugi.group_id) FROM user_group_ids ugi), '{}') AS groups
    FROM user_permissions up
  `.execute(db);

  const row = result.rows[0] ?? { groups: [], permissions: [] };

  return { groups: row.groups, permissions: row.permissions };
};

export class SingleUserStrategy implements AuthStrategy {
  public async getUserFromEvent(_event: H3Event): Promise<AuthUser | null> {
    const db = await useDb();

    const user = await db
      .selectFrom("users")
      .select(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
      .where("username", "=", config.singleUser.username)
      .where("email", "=", config.singleUser.email)
      .executeTakeFirst();

    if (!user) {
      logger.warn("Single user not found in database");
      return null;
    }

    const ctx = await getUserAuthContext(user.id);

    return { ...user, ...ctx };
  }
}

export class OIDCStrategy implements AuthStrategy {
  public async getUserFromEvent(event: H3Event): Promise<AuthUser | null> {
    const lucia = useLucia();

    const token = getCookie(event, lucia.cookieName);
    if (!token) {
      return null;
    }

    const { session, fresh } = await lucia.validateSession(token);
    if (!session) {
      return null;
    }

    if (fresh) {
      appendHeader(event, "Set-Cookie", lucia.createSessionCookie(token, session.expiresAt));
    }

    const ctx = await getUserAuthContext(session.user.id);

    return { ...session.user, ...ctx };
  }
}

interface ProxyCacheEntry {
  expiresAt: number;
  user: AuthUser;
}

const PROXY_CACHE_MAX_ENTRIES = 10_000;
const proxyCache = new Map<string, ProxyCacheEntry>();

const parseHeaderList = (value: string | undefined): string[] => (value ? value.split(/\s*[|;,]+\s*/) : []);

export class ProxyStrategy implements AuthStrategy {
  public async getUserFromEvent(event: H3Event): Promise<AuthUser | null> {
    const expectedSecret = config.proxy.secret;
    if (expectedSecret === "changeme") {
      logger.error("Proxy secret must be changed from its default value");
      return null;
    }

    const receivedSecret = getHeader(event, config.proxy.secretHeader) ?? "";
    if (
      receivedSecret.length !== expectedSecret.length ||
      !timingSafeEqual(Buffer.from(receivedSecret), Buffer.from(expectedSecret))
    ) {
      return null;
    }

    const username = getHeader(event, config.proxy.headerUsername);
    const fullname = getHeader(event, config.proxy.headerFullname);
    const email = getHeader(event, config.proxy.headerEmail);

    if (!username || !fullname || !email) {
      return null;
    }

    const picture = getHeader(event, config.proxy.headerPicture) ?? null;
    const headerRoles = parseHeaderList(getHeader(event, config.proxy.headerRoles));
    const roles = config.proxy.syncRoles ? (headerRoles.length > 0 ? headerRoles : [Roles.Member]) : null;
    const groups = config.proxy.syncGroups ? parseHeaderList(getHeader(event, config.proxy.headerGroups)) : null;

    const ttlMs = config.proxy.cacheTtlSec * 1000;
    const cacheKey = ttlMs > 0 ? JSON.stringify([username, fullname, email, picture, roles, groups]) : null;
    const now = Date.now();

    if (cacheKey !== null) {
      const cached = proxyCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.user;
      }
    }

    try {
      const user = await getOrCreateUserFromProxy({ username, fullname, email, picture });

      if (roles !== null) {
        await syncUserRoles(user.id, roles);
      }

      if (groups !== null) {
        await syncUserGroups(user.id, groups);
      }

      const ctx = await getUserAuthContext(user.id);
      const authUser: AuthUser = { ...user, ...ctx };

      if (cacheKey !== null) {
        proxyCache.set(cacheKey, { expiresAt: now + ttlMs, user: authUser });
        if (proxyCache.size > PROXY_CACHE_MAX_ENTRIES) {
          const oldest = proxyCache.keys().next().value;
          if (oldest !== undefined) {
            proxyCache.delete(oldest);
          }
        }
      }

      return authUser;
    } catch (error) {
      logger.error({ username, email, error }, "User creation via proxy headers failed");
      return null;
    }
  }
}

export const getAuthStrategy = (): AuthStrategy => {
  switch (config.authMode) {
    case AuthModes.SingleUser:
      return new SingleUserStrategy();
    case AuthModes.OIDC:
      return new OIDCStrategy();
    case AuthModes.Proxy:
      return new ProxyStrategy();
    default:
      throw new Error(`Invalid auth mode: ${config.authMode}`);
  }
};
