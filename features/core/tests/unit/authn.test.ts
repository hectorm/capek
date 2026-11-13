import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "#layers/core/shared/schema";
import { Sessions } from "#layers/core/server/lib/authn/sessions";
import { closeDb, createTestDb } from "#layers/core/tests/unit/helpers/db";

let db: Kysely<Database>;

const alice = crypto.randomUUID();

beforeAll(async () => {
  db = await createTestDb();

  await db
    .insertInto("users")
    .values([{ id: alice, username: "alice", fullname: "Alice", email: "alice@example.com" }])
    .execute();
});

afterAll(async () => {
  await closeDb();
});

describe("sessions", () => {
  it("are extended while they are used, until they reach their time limit", async () => {
    const sessions = new Sessions({ cookieName: "session", durationSec: 60, maxDurationSec: 100 });
    const { token } = await sessions.createSession(alice);

    const age = async (createdAgoSec: number, expiresInSec: number): Promise<void> => {
      const createdAt = new Date(Date.now() - createdAgoSec * 1000);
      const expiresAt = new Date(Date.now() + expiresInSec * 1000);
      await sql`UPDATE sessions SET created_at = ${createdAt}, expires_at = ${expiresAt}`.execute(db);
    };

    await age(10, 20);
    const extended = await sessions.validateSession(token);
    expect(extended.fresh).toBe(true);
    expect(extended.session?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

    await age(90, 5);
    const limited = await sessions.validateSession(token);
    expect(limited.fresh).toBe(true);
    expect(limited.session?.expiresAt.getTime()).toBe(Number(limited.session?.createdAt.getTime()) + 100_000);
    expect(await sessions.validateSession(token)).toMatchObject({ session: { userId: alice }, fresh: false });

    await age(100, 0);
    expect(await sessions.validateSession(token)).toEqual({ session: null, fresh: false });
  });
});
