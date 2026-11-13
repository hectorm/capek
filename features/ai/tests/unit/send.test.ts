import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Kysely } from "kysely";
import { createApp, eventHandler, toNodeListener } from "h3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import send from "#layers/ai/server/api/ai/chat/send";
import { AiRolePermissions } from "#layers/ai/shared/rbac";
import { closeDb, createAiTestDb, insertAgent, insertUsers } from "#layers/ai/tests/unit/helpers/db";
import { useLogger } from "#layers/core/server/lib/logger";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";

let db: Kysely<Database>;
let server: Server;
let url: string;

const alice = crypto.randomUUID();
// Auditors read every agent, but only use the ones shared with them
const auditor = {
  id: alice,
  groups: [],
  permissions: [...CoreRolePermissions[Roles.Auditor], ...AiRolePermissions[Roles.Auditor]],
} as unknown as AuthUser;

beforeAll(async () => {
  db = await createAiTestDb();
  await insertUsers(db, { alice });

  const app = createApp();
  app.use(
    eventHandler((event) => {
      event.context.user = auditor;
      event.context.logger = useLogger();
    }),
  );
  app.use("/send", send);
  server = createServer(toNodeListener(app)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/send`;
});

afterAll(async () => {
  server.close();
  await closeDb();
});

const createSession = async (agentId: string): Promise<string> => {
  const session = await db
    .insertInto("aiChatSessions")
    .values({ userId: alice, agentId, title: "" })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return session.id;
};

const sendMessage = (sessionId: string): Promise<Response> => {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message: "Hi" }),
  });
};

const messages = (sessionId: string) => {
  return db.selectFrom("aiChatMessages").select(["id"]).where("sessionId", "=", sessionId).execute();
};

describe("chat send route", () => {
  it("rejects a chat whose agent the user cannot use", async () => {
    const sessionId = await createSession(await insertAgent(db, "unshared-agent"));

    expect((await sendMessage(sessionId)).status).toBe(404);
    expect(await messages(sessionId)).toEqual([]);
  });

  it("rejects a message while another answer is running", async () => {
    const agentId = await insertAgent(db, "busy-agent");
    await db.insertInto("aiAgentAccess").values({ agentId, userId: alice, role: "user" }).execute();
    const sessionId = await createSession(agentId);
    const now = new Date();
    await db
      .insertInto("aiAgentExecutions")
      .values({ sessionId, agentId, userId: alice, status: "running", startedAt: now, lastActivityAt: now })
      .execute();

    expect((await sendMessage(sessionId)).status).toBe(409);
    expect(await messages(sessionId)).toEqual([]);
  });
});
