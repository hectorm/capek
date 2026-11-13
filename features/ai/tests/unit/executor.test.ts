import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { OpenAICompletionRequest } from "#layers/ai/shared/openai";
import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { FeatureToolProvider } from "#layers/core/server/lib/tools/define";
import type { Database } from "#layers/core/shared/schema";
import { AgentExecutor } from "#layers/ai/server/lib/agents/executor";
import { MaxIterationsError, MaxOutputTokensError, RefusalError, TimeoutError } from "#layers/ai/server/lib/errors";
import { AiRolePermissions } from "#layers/ai/shared/rbac";
import { closeDb, createAiTestDb, insertAgent } from "#layers/ai/tests/unit/helpers/db";
import { streamOf } from "#layers/ai/tests/unit/helpers/llm";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";

// Tools that stand in for the ones of another feature, one telling what it does and another showing a chart
vi.mock("#layers/core/server/lib/tools", () => {
  const provider: FeatureToolProvider = {
    name: "notes",
    feature: "notes",
    label: "notes.tools.label",
    load: () => {
      return Promise.resolve({
        tools: [
          {
            name: "notes_read",
            description: "Read a note",
            parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
            execute: (args) => Promise.resolve(`Content of ${String(args.note)}: ${"hello ".repeat(100)}`),
            describe: (args) => `Reads the note "${String(args.note)}"`,
          },
          {
            name: "notes_export",
            description: "Export the notes",
            parameters: { type: "object", properties: {} },
            execute: () => Promise.resolve("note ".repeat(1000)),
          },
          {
            name: "notes_count",
            description: "Count the notes",
            parameters: { type: "object", properties: {} },
            execute: () => Promise.resolve("3"),
          },
          {
            name: "notes_scan",
            description: "Scan a note",
            parameters: { type: "object", properties: {} },
            execute: () => Promise.resolve("Scanned \ud83d\0"),
          },
          {
            name: "notes_chart",
            description: "Chart the notes",
            parameters: { type: "object", properties: { points: { type: "number" } } },
            execute: (args, context) => {
              const data = Array<number>(Number(args.points ?? 1)).fill(3);
              context.show?.({ type: "chart", option: { series: [{ type: "bar", data }] } });
              return Promise.resolve("Shown");
            },
          },
        ],
      });
    },
  };
  return { getToolProviders: () => [provider] };
});

let db: Kysely<Database>;

const alice = crypto.randomUUID();
const user = {
  id: alice,
  groups: [],
  permissions: [...CoreRolePermissions[Roles.Admin], ...AiRolePermissions[Roles.Admin]],
} as unknown as AuthUser;

let agentId: string;
let streamingAgentId: string;
let smallContextAgentId: string;
let singleIterationAgentId: string;
let hiddenToolCallsAgentId: string;
let smallPartsAgentId: string;
let triageAgentId: string;
let shortResponsesAgentId: string;
let impatientAgentId: string;

const readNote = { id: "call-1", type: "function", function: { name: "notes_read", arguments: '{"note":"a"}' } };
const countNotes = { id: "call-2", type: "function", function: { name: "notes_count", arguments: "{}" } };
const chartNotes = { id: "call-3", type: "function", function: { name: "notes_chart", arguments: "{}" } };

beforeAll(async () => {
  db = await createAiTestDb();

  await db
    .insertInto("users")
    .values({ id: alice, username: "alice", fullname: "Alice", email: "alice@example.com" })
    .execute();

  const llmProvider = await db
    .insertInto("aiLlmProviders")
    .values({
      name: "executor-provider",
      description: "",
      apiUrl: "http://llm.localhost/v1",
      apiType: "chat-completions",
      apiKey: "hunter2",
      headers: "[]",
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  const createAgent = async (name: string, settings: Record<string, unknown> = {}): Promise<string> => {
    const id = await insertAgent(db, name);
    await db
      .updateTable("aiAgents")
      .set({
        instructions: "Be brief.",
        llmProviderId: llmProvider.id,
        toolProviders: ["notes"],
        streaming: false,
        ...settings,
      })
      .where("id", "=", id)
      .execute();
    return id;
  };

  agentId = await createAgent("executor-agent");
  streamingAgentId = await createAgent("executor-streaming-agent", { streaming: true });
  smallContextAgentId = await createAgent("executor-small-context-agent", { maxContextChars: 300 });
  singleIterationAgentId = await createAgent("executor-single-iteration-agent", { maxIterations: 1 });
  hiddenToolCallsAgentId = await createAgent("executor-hidden-tool-calls-agent", { showToolCalls: false });
  smallPartsAgentId = await createAgent("executor-small-parts-agent", { maxToolPartsChars: 1000 });
  triageAgentId = await createAgent("executor-triage-agent", { type: "triage", toolProviders: [] });
  shortResponsesAgentId = await createAgent("executor-short-responses-agent", { maxToolResponseChars: 1000 });
  impatientAgentId = await createAgent("executor-impatient-agent", { timeoutSec: 1 });

  await db.insertInto("aiTriageSpecialists").values({ triageAgentId, specialistAgentId: agentId }).execute();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeDb();
});

const createSession = async (sessionAgentId: string): Promise<string> => {
  const session = await db
    .insertInto("aiChatSessions")
    .values({ userId: alice, agentId: sessionAgentId, title: "" })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return session.id;
};

// The model answers with the given responses in order, and its requests are kept to check them
const fakeModel = (responses: Response[]): OpenAICompletionRequest[] => {
  const requests: OpenAICompletionRequest[] = [];
  vi.stubGlobal("fetch", (_url: URL, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string) as OpenAICompletionRequest);
    return Promise.resolve(responses.shift() ?? Response.error());
  });
  return requests;
};

const answer = (content: string | null, toolCalls?: unknown[], finishReason = "stop"): Response => {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "reasoner",
    choices: [
      { index: 0, message: { role: "assistant", content, tool_calls: toolCalls }, finish_reason: finishReason },
    ],
  });
};

const executions = (sessionId: string) => {
  return db
    .selectFrom("aiAgentExecutions")
    .select(["status", "errorMessage"])
    .where("sessionId", "=", sessionId)
    .orderBy("createdAt")
    .execute();
};

const streamedAnswer = (deltas: Record<string, unknown>[]): Response => {
  const chunk = { object: "chat.completion.chunk", created: 0, model: "reasoner" };
  const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
  return new Response(streamOf([...deltas.map((delta) => ({ ...chunk, choices: [{ index: 0, delta }] })), end]));
};

const decoder = new TextDecoder();

const chat = async (sessionId: string, sessionAgentId: string, message: string) => {
  const executor = new AgentExecutor({ sessionId, user, message });

  let tokens = "";
  const parts: unknown[] = [];
  let error: unknown;
  try {
    for await (const bytes of executor.executeStream(sessionAgentId)) {
      const [, event, data] = /^event: (.*)\ndata: (.*)\n\n$/.exec(decoder.decode(bytes)) ?? [];
      if (event === "token" && data) {
        tokens += JSON.parse(data) as string;
      } else if (event === "part" && data) {
        parts.push(JSON.parse(data));
      }
    }
  } catch (caught) {
    error = caught;
  }

  return { tokens, parts, error };
};

const answers = (sessionId: string) => {
  return db
    .selectFrom("aiChatMessages")
    .select(["content", "items"])
    .where("sessionId", "=", sessionId)
    .where("role", "=", "assistant")
    .orderBy("createdAt")
    .execute();
};

const roles = (request?: OpenAICompletionRequest): string[] => {
  return (request?.messages ?? []).map((message) => (message.tool_calls ? `${message.role} with tools` : message.role));
};

describe("agent executor", () => {
  it("keeps the tools that the model calls with its answer and sends them in the next turn", async () => {
    const sessionId = await createSession(agentId);

    const requests = fakeModel([answer(null, [readNote]), answer("The note says hello.")]);
    const { tokens, parts } = await chat(sessionId, agentId, "What does the note a say?");

    expect(tokens).toBe("The note says hello.");
    expect(parts).toEqual([{ type: "tool", id: "call-1", name: "notes_read", description: 'Reads the note "a"' }]);
    expect(requests[1]?.messages.slice(-2)).toMatchObject([
      { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "notes_read" } }] },
      { role: "tool", tool_call_id: "call-1", content: expect.stringContaining("Content of a") as string },
    ]);
    expect(await answers(sessionId)).toEqual([
      {
        content: "The note says hello.",
        items: [
          {
            type: "function_call",
            call_id: "call-1",
            name: "notes_read",
            arguments: '{"note":"a"}',
            description: 'Reads the note "a"',
          },
          {
            type: "function_call_output",
            call_id: "call-1",
            output: expect.stringContaining("Content of a") as string,
          },
          { type: "message", role: "assistant", content: "The note says hello." },
        ],
      },
    ]);

    const nextRequests = fakeModel([answer("Bye.")]);
    await chat(sessionId, agentId, "Thanks, bye.");

    expect(roles(nextRequests[0])).toEqual(["system", "user", "assistant with tools", "tool", "assistant", "user"]);
  });

  it("streams the answer and gives back to the model what it needs along with its tool calls", async () => {
    const sessionId = await createSession(streamingAgentId);
    const signature = { google: { thought_signature: "signature" } };

    const requests = fakeModel([
      streamedAnswer([{ role: "assistant", tool_calls: [{ ...readNote, index: 0, extra_content: signature }] }]),
      streamedAnswer([{ content: "The note " }, { content: "says hello." }]),
    ]);
    const { tokens } = await chat(sessionId, streamingAgentId, "What does the note a say?");

    expect(tokens).toBe("The note says hello.");
    expect(requests[1]?.messages.at(-2)).toMatchObject({ tool_calls: [{ id: "call-1", extra_content: signature }] });
    expect((await answers(sessionId)).map((message) => message.items.map((item) => item.type))).toEqual([
      ["function_call", "function_call_output", "message"],
    ]);
  });

  it("keeps only the text of an answer whose tool calls do not fit in the context", async () => {
    const sessionId = await createSession(smallContextAgentId);

    fakeModel([answer(null, [readNote]), answer("The note says hello.")]);
    await chat(sessionId, smallContextAgentId, "What does the note a say?");

    const requests = fakeModel([answer("Bye.")]);
    await chat(sessionId, smallContextAgentId, "Thanks, bye.");

    expect(roles(requests[0])).toEqual(["system", "user", "assistant", "user"]);
  });

  it("keeps an answer without text only when one of its tool calls tells what it did", async () => {
    const countSessionId = await createSession(singleIterationAgentId);
    fakeModel([answer(null, [countNotes])]);
    const { error } = await chat(countSessionId, singleIterationAgentId, "How many notes are there?");

    expect(error).toBeInstanceOf(MaxIterationsError);
    expect(await answers(countSessionId)).toEqual([]);

    const readSessionId = await createSession(singleIterationAgentId);
    fakeModel([answer(null, [readNote])]);
    await chat(readSessionId, singleIterationAgentId, "What does the note a say?");

    expect(await answers(readSessionId)).toMatchObject([
      {
        content: "",
        items: [{ type: "function_call", description: 'Reads the note "a"' }, { type: "function_call_output" }],
      },
    ]);
  });

  it("does not tell what the tool calls of an agent do when it does not show them", async () => {
    const sessionId = await createSession(hiddenToolCallsAgentId);

    fakeModel([answer(null, [readNote]), answer("The note says hello.")]);
    const { parts } = await chat(sessionId, hiddenToolCallsAgentId, "What does the note a say?");

    expect(parts).toEqual([]);
    expect((await answers(sessionId)).flatMap((message) => message.items)).toEqual([
      { type: "function_call", call_id: "call-1", name: "notes_read", arguments: '{"note":"a"}' },
      { type: "function_call_output", call_id: "call-1", output: expect.stringContaining("Content of a") as string },
      { type: "message", role: "assistant", content: "The note says hello." },
    ]);
  });

  it("shows the charts of the tool calls and keeps them with the answer", async () => {
    const sessionId = await createSession(hiddenToolCallsAgentId);
    const option = { series: [{ type: "bar", data: [3] }] };

    fakeModel([answer(null, [chartNotes]), answer("There are 3 notes.")]);
    const { parts } = await chat(sessionId, hiddenToolCallsAgentId, "Chart the notes.");

    expect(parts).toEqual([{ type: "chart", option }]);
    expect((await answers(sessionId)).flatMap((message) => message.items)).toMatchObject([
      { type: "function_call", name: "notes_chart", parts: [{ type: "chart", option }] },
      { type: "function_call_output", output: "Shown" },
      { type: "message", content: "There are 3 notes." },
    ]);
  });

  it("limits what the tool calls of an answer show in all", async () => {
    const sessionId = await createSession(smallPartsAgentId);
    const chartManyNotes = (id: string) => {
      return { id, type: "function", function: { name: "notes_chart", arguments: '{"points":300}' } };
    };

    const requests = fakeModel([
      answer(null, [chartManyNotes("call-4"), chartManyNotes("call-5")]),
      answer("That is too much to show."),
    ]);
    const { parts } = await chat(sessionId, smallPartsAgentId, "Chart many notes, twice.");

    expect(parts).toHaveLength(1);
    expect(requests[1]?.messages.slice(-2)).toMatchObject([
      { role: "tool", tool_call_id: "call-4", content: "Shown" },
      {
        role: "tool",
        tool_call_id: "call-5",
        content: expect.stringContaining("cannot show the user more than 1000 characters") as string,
      },
    ]);
  });

  it("gives a triage agent what was said, without the tool calls of its specialists", async () => {
    const sessionId = await createSession(triageAgentId);
    const route = {
      id: "call-0",
      type: "function",
      function: {
        name: "route_to_specialist",
        arguments: JSON.stringify({ specialistId: agentId, routingReason: "Routing to the specialist" }),
      },
    };

    fakeModel([answer(null, [route]), answer(null, [readNote]), answer("The note says hello.")]);
    await chat(sessionId, triageAgentId, "What does the note a say?");

    const requests = fakeModel([answer(null, [route]), answer("Bye.")]);
    await chat(sessionId, triageAgentId, "Thanks, bye.");

    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toEqual(["route_to_specialist"]);
    expect(roles(requests[0])).toEqual(["system", "user", "assistant", "user"]);
    expect(roles(requests[1])).toEqual(["system", "user", "assistant with tools", "tool", "assistant", "user"]);
  });

  it("fails the answers that the model declines or leaves unfinished, instead of leaving nothing", async () => {
    const sessionId = await createSession(agentId);

    fakeModel([answer(null, undefined, "content_filter")]);
    const declined = await chat(sessionId, agentId, "Do something that is not allowed");
    expect(declined.error).toBeInstanceOf(RefusalError);
    expect(await answers(sessionId)).toHaveLength(0);

    fakeModel([answer("Once upon a", undefined, "length")]);
    const cut = await chat(sessionId, agentId, "Tell me a long story");
    expect(cut.error).toBeInstanceOf(MaxOutputTokensError);
    expect(cut.tokens).toBe("Once upon a");
    expect((await answers(sessionId)).map((row) => row.content)).toEqual(["Once upon a"]);

    expect((await executions(sessionId)).map((execution) => execution.status)).toEqual(["failed", "failed"]);
  });

  it("stops waiting for the model when the time of the agent runs out", async () => {
    const sessionId = await createSession(impatientAgentId);

    vi.stubGlobal("fetch", (_url: URL, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      });
    });
    const late = await chat(sessionId, impatientAgentId, "Are you there?");
    expect(late.error).toBeInstanceOf(TimeoutError);
    expect(await executions(sessionId)).toEqual([{ status: "cancelled", errorMessage: "The operation timed out" }]);
  });

  it("ends the execution when the answer stops being read, so that the session takes new messages", async () => {
    const sessionId = await createSession(streamingAgentId);

    fakeModel([streamedAnswer([{ content: "One " }, { content: "two " }, { content: "three" }])]);
    const stopped = new AgentExecutor({ sessionId, user, message: "Count to three" });
    const stream = stopped.executeStream(streamingAgentId);
    await stream.next();
    await stream.return(undefined);
    expect(await executions(sessionId)).toEqual([{ status: "cancelled", errorMessage: "The operation was aborted" }]);

    fakeModel([streamedAnswer([{ content: "Four" }])]);
    const next = await chat(sessionId, streamingAgentId, "And the next one?");
    expect(next.error).toBeUndefined();
    expect(next.tokens).toBe("Four");
  });

  it("frees the sessions of the executions that stopped reporting activity", async () => {
    const sessionId = await createSession(agentId);
    const execution = (lastActivityAt: Date) => {
      return db
        .insertInto("aiAgentExecutions")
        .values({ sessionId, agentId, userId: alice, status: "running", startedAt: lastActivityAt, lastActivityAt })
        .returning(["id"])
        .executeTakeFirstOrThrow();
    };

    const alive = await execution(new Date());
    expect(await AgentExecutor.failAbandonedExecutions(db, sessionId)).toBe(0);

    await db
      .updateTable("aiAgentExecutions")
      .set({ lastActivityAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where("id", "=", alive.id)
      .execute();
    expect(await AgentExecutor.failAbandonedExecutions(db, crypto.randomUUID())).toBe(0);
    expect(await AgentExecutor.failAbandonedExecutions(db, sessionId)).toBe(1);
    expect((await executions(sessionId)).map((row) => row.status)).toEqual(["failed"]);

    fakeModel([answer("Hello again.")]);
    expect((await chat(sessionId, agentId, "Hello?")).tokens).toBe("Hello again.");
  });

  it("keeps the responses of the tools as short as the model gets them", async () => {
    const sessionId = await createSession(shortResponsesAgentId);
    const exportNotes = { id: "call-4", type: "function", function: { name: "notes_export", arguments: "{}" } };

    const requests = fakeModel([answer(null, [exportNotes]), answer("Exported.")]);
    await chat(sessionId, shortResponsesAgentId, "Export the notes");

    const sent = requests[1]?.messages.find((message) => message.role === "tool")?.content;
    expect(sent).toContain("[Response truncated: 5000 characters, showing first 1000]");

    const stored = await db
      .selectFrom("aiAgentToolCalls")
      .select(["result"])
      .where("toolName", "=", "notes_export")
      .executeTakeFirstOrThrow();
    expect(stored.result).toBe(sent);
  });

  it("limits what the tools of an answer return to the size of its context", async () => {
    const sessionId = await createSession(smallContextAgentId);

    const requests = fakeModel([answer(null, [readNote]), answer(null, [readNote]), answer("The note says hello.")]);
    await chat(sessionId, smallContextAgentId, "What does the note a say?");

    const sent = requests[2]?.messages.filter((message) => message.role === "tool").map((message) => message.content);
    expect(sent).toEqual([
      expect.stringContaining("showing first 254]") as string,
      "\n\n[Response truncated: 614 characters, showing first 0]",
    ]);
  });

  it("keeps the answer whose tools return characters that cannot be stored", async () => {
    const sessionId = await createSession(agentId);
    const scanNotes = { id: "call-5", type: "function", function: { name: "notes_scan", arguments: "{}" } };

    const requests = fakeModel([answer(null, [scanNotes]), answer("Scanned.")]);
    await chat(sessionId, agentId, "Scan the note");

    expect(requests[1]?.messages.at(-1)?.content).toBe("Scanned \uFFFD\uFFFD");
    expect((await answers(sessionId)).map((message) => message.content)).toEqual(["Scanned."]);
  });
});
