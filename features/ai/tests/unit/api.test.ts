import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Kysely } from "kysely";
import { createApp, eventHandler, toNodeListener } from "h3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "#layers/ai/shared/schema";
import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import send from "#layers/ai/server/api/ai/chat/send";
import { AgentExecutor } from "#layers/ai/server/lib/agents/executor";
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

const sendMessage = (
  sessionId: string,
  options: { replaceMessageId?: string; userMessageId?: string } = {},
  signal?: AbortSignal,
): Promise<Response> => {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message: "Hi", ...options }),
    signal,
  });
};

const messages = (sessionId: string): Promise<Pick<ChatMessage, "id">[]> => {
  return db.selectFrom("aiChatMessages").select(["id"]).where("sessionId", "=", sessionId).orderBy("id").execute();
};

describe("chat send route", () => {
  it("acknowledges a turn before the agent produces its first chunk", async () => {
    const agentId = await insertAgent(db, "slow-agent");
    await db.insertInto("aiAgentAccess").values({ agentId, userId: alice, role: "user" }).execute();
    const sessionId = await createSession(agentId);
    const reply = Promise.withResolvers<undefined>();
    const stream = vi.spyOn(AgentExecutor.prototype, "executeStream").mockImplementation(async function* () {
      await reply.promise;
      yield new TextEncoder().encode('event: token\ndata: "Hi"\n\n');
    });
    try {
      const response = await sendMessage(sessionId, {}, AbortSignal.timeout(5000));
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      reply.resolve(undefined);
      expect(await response.text()).toContain("event: token");
    } finally {
      reply.resolve(undefined);
      stream.mockRestore();
    }
  });

  it("rejects a request with an invalid body", async () => {
    expect((await sendMessage("not-a-session")).status).toBe(400);
  });

  it("rejects a chat whose agent the user cannot use", async () => {
    const sessionId = await createSession(await insertAgent(db, "unshared-agent"));

    expect((await sendMessage(sessionId)).status).toBe(404);
    expect(await messages(sessionId)).toEqual([]);
  });

  it("keeps the original turns when the edit target or replacement is invalid", async () => {
    const agentId = await insertAgent(db, "edit-agent");
    await db.insertInto("aiAgentAccess").values({ agentId, userId: alice, role: "user" }).execute();
    const sessionId = await createSession(agentId);
    const otherSessionId = await createSession(agentId);
    // The IDs break the tie between messages inserted with the same timestamp
    const target = "00000000-0000-4000-8000-000000000001";
    const answer = "00000000-0000-4000-8000-000000000002";
    const other = crypto.randomUUID();
    await db
      .insertInto("aiChatMessages")
      .values([
        { sessionId, id: target, role: "user", content: "original" },
        { sessionId, id: answer, role: "assistant", content: "answer" },
        { sessionId: otherSessionId, id: other, role: "user", content: "other" },
      ])
      .execute();

    expect((await sendMessage(sessionId, { replaceMessageId: other })).status).toBe(404);
    expect((await sendMessage(sessionId, { replaceMessageId: answer })).status).toBe(404);
    expect((await sendMessage(sessionId, { replaceMessageId: target, userMessageId: other })).status).toBe(500);
    expect(await messages(sessionId)).toEqual([{ id: target }, { id: answer }]);
    expect(await messages(otherSessionId)).toEqual([{ id: other }]);
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
