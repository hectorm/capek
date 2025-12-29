import { Buffer } from "node:buffer";

import { useRuntimeConfig } from "nitropack/runtime/config";

import { useDb } from "~~/server/lib/database";
import { useLogger } from "~~/server/lib/logger";

const config = useRuntimeConfig();
const logger = useLogger();

export interface LuciaOptions {
  cookieName: string;
  durationSec: number;
}

export class Lucia {
  /*
   * Based on Lucia (https://lucia-auth.com)
   */

  public cookieName: string;
  public durationSec: number;

  public constructor(options: LuciaOptions) {
    this.cookieName = options.cookieName;
    this.durationSec = options.durationSec;
  }

  public generateSessionToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Buffer.from(bytes).toString("base64url");
  }

  public async createSession(userId: string, sid?: string | null, idToken?: string | null) {
    const db = await useDb();

    const token = this.generateSessionToken();
    const now = Date.now();

    const result = await db
      .transaction()
      .setIsolationLevel("read committed")
      .execute(async (trx) => {
        const [session, user] = await Promise.all([
          trx
            .insertInto("sessions")
            .values({
              token,
              userId,
              sid: sid ?? null,
              idToken: idToken ?? null,
              expiresAt: new Date(now + this.durationSec * 1000),
            })
            .returning(["id", "token", "userId", "sid", "idToken", "createdAt", "expiresAt"])
            .executeTakeFirstOrThrow(),
          trx
            .updateTable("users")
            .set({ lastLoginAt: new Date(now) })
            .where("id", "=", userId)
            .returning(["id", "username", "fullname", "email", "picture", "lastLoginAt", "createdAt", "updatedAt"])
            .executeTakeFirstOrThrow(),
        ]);

        return { session, user };
      });

    logger.info({ userId, sid }, "Session created");
    return { ...result.session, user: result.user };
  }

  public async validateSession(token: string) {
    const db = await useDb();

    return db
      .transaction()
      .setIsolationLevel("read committed")
      .execute(async (trx) => {
        const result = await trx
          .selectFrom("sessions")
          .innerJoin("users", "users.id", "sessions.userId")
          .select([
            "sessions.id",
            "sessions.token",
            "sessions.userId",
            "sessions.sid",
            "sessions.idToken",
            "sessions.createdAt",
            "sessions.expiresAt",
            "users.id as user.id",
            "users.username as user.username",
            "users.fullname as user.fullname",
            "users.email as user.email",
            "users.picture as user.picture",
            "users.lastLoginAt as user.lastLoginAt",
            "users.createdAt as user.createdAt",
            "users.updatedAt as user.updatedAt",
          ])
          .where("sessions.token", "=", token)
          .forUpdate()
          .executeTakeFirst();

        if (!result) {
          logger.debug("Session validation failed: not found");
          return { session: null, fresh: false };
        }

        const session: Awaited<ReturnType<Lucia["createSession"]>> = {
          id: result.id,
          token: result.token,
          userId: result.userId,
          sid: result.sid,
          idToken: result.idToken,
          createdAt: result.createdAt,
          expiresAt: result.expiresAt,
          user: {
            id: result["user.id"],
            username: result["user.username"],
            fullname: result["user.fullname"],
            email: result["user.email"],
            picture: result["user.picture"],
            lastLoginAt: result["user.lastLoginAt"],
            createdAt: result["user.createdAt"],
            updatedAt: result["user.updatedAt"],
          },
        };

        const now = Date.now();
        if (now >= session.expiresAt.getTime()) {
          logger.debug({ sessionId: session.id, userId: session.userId }, "Session expired and invalidated");
          await trx.deleteFrom("sessions").where("id", "=", session.id).execute();
          return { session: null, fresh: false };
        }

        let fresh = false;
        if (now >= session.expiresAt.getTime() - (this.durationSec / 2) * 1000) {
          session.expiresAt = new Date(now + this.durationSec * 1000);
          await trx
            .updateTable("sessions")
            .set({ expiresAt: session.expiresAt })
            .where("id", "=", session.id)
            .execute();
          fresh = true;
          logger.debug({ sessionId: session.id, userId: session.userId }, "Session refreshed");
        }

        logger.trace({ sessionId: session.id, userId: session.userId }, "Session validated");
        return { session, fresh };
      });
  }

  public async invalidateSession(token: string): Promise<void> {
    const db = await useDb();

    const result = await db
      .deleteFrom("sessions")
      .where("token", "=", token)
      .returning(["id", "userId"])
      .executeTakeFirst();

    if (result) {
      logger.debug({ sessionId: result.id, userId: result.userId }, "Session invalidated");
    } else {
      logger.debug("Session invalidation attempted but session not found");
    }
  }

  public async invalidateAllSessions(userId: string): Promise<void> {
    const db = await useDb();

    const result = await db.deleteFrom("sessions").where("userId", "=", userId).executeTakeFirst();
    const count = Number(result.numDeletedRows || 0);

    logger.info({ userId, count }, "All user sessions invalidated");
  }

  public async invalidateSessionsBySid(sid: string): Promise<void> {
    const db = await useDb();

    const result = await db.deleteFrom("sessions").where("sid", "=", sid).executeTakeFirst();
    const count = Number(result.numDeletedRows || 0);

    logger.info({ sid, count }, "Sessions invalidated by sid");
  }

  public createSessionCookie(token: string, expiresAt: Date): string {
    let cookie = `${this.cookieName}=${token}; Path=/; Expires=${expiresAt.toUTCString()}; HttpOnly; SameSite=Lax`;
    if (!import.meta.dev) cookie += "; Secure; Partitioned";
    return cookie;
  }

  public createSessionDeleteCookie(): string {
    let cookie = `${this.cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
    if (!import.meta.dev) cookie += "; Secure; Partitioned";
    return cookie;
  }
}

let luciaInstance: Lucia | null = null;

export const useLucia = (): Lucia => {
  luciaInstance ??= new Lucia(config.session);
  return luciaInstance;
};
