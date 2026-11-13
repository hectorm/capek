import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatTablePart } from "#layers/ai/shared/chat";
import type { OpenAICompletionRequest } from "#layers/ai/shared/openai";
import type { NewAgent } from "#layers/ai/shared/schema";
import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { FeatureToolProvider } from "#layers/core/server/lib/tools/define";
import type { Database } from "#layers/core/shared/schema";
import { AgentExecutor } from "#layers/ai/server/lib/agents/executor";
import { MaxIterationsError, MaxOutputTokensError, RefusalError, TimeoutError } from "#layers/ai/server/lib/errors";
import { loadTable } from "#layers/ai/server/lib/tables";
import { AiRolePermissions } from "#layers/ai/shared/rbac";
import {
  closeDb,
  createAiTestDb,
  insertAgent,
  insertLlmProvider,
  insertSkill,
  insertUsers,
} from "#layers/ai/tests/unit/helpers/db";
import { chatCompletion, chatCompletionStream } from "#layers/ai/tests/unit/helpers/llm";
import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";

// Tools that stand in for the ones of another feature, one telling what it does and others showing a chart or a table
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
              context.show?.({ type: "chart", name: "Notes", option: { series: [{ type: "bar", data }] } });
              return Promise.resolve("Shown");
            },
          },
          {
            name: "notes_table",
            description: "List the notes",
            parameters: { type: "object", properties: { rows: { type: "number" } } },
            execute: (args, context) => {
              const rows = Array.from({ length: Number(args.rows) }, (_, index) => [`note ${String(index)}`]);
              context.show?.({ type: "table", name: "Notes", columns: ["note"], rows });
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
let llmProviderId: string;

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
const admin = {
  id: alice,
  groups: [],
  permissions: [...CoreRolePermissions[Roles.Admin], ...AiRolePermissions[Roles.Admin]],
} as unknown as AuthUser;
const member = {
  id: bob,
  groups: [],
  permissions: [...CoreRolePermissions[Roles.Member], ...AiRolePermissions[Roles.Member]],
} as unknown as AuthUser;

const readNote = { id: "call-1", type: "function", function: { name: "notes_read", arguments: '{"note":"a"}' } };
const countNotes = { id: "call-2", type: "function", function: { name: "notes_count", arguments: "{}" } };
const chartNotes = { id: "call-3", type: "function", function: { name: "notes_chart", arguments: "{}" } };
const listNotes = (rows: number) => {
  return { id: "call-4", type: "function", function: { name: "notes_table", arguments: JSON.stringify({ rows }) } };
};

beforeAll(async () => {
  db = await createAiTestDb();
  await insertUsers(db, { alice, bob });
  llmProviderId = await insertLlmProvider(db, "executor-provider");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeDb();
});

interface TestChat {
  sessionId: string;
  agentId: string;
  user: AuthUser;
}

// A chat with a new agent of the given settings, which answers briefly with the tools of the notes
const createChat = async (settings: Partial<NewAgent> = {}, user: AuthUser = admin): Promise<TestChat> => {
  const agentId = await insertAgent(db, `agent-${crypto.randomUUID()}`, {
    instructions: "Be brief.",
    llmProviderId,
    toolProviders: ["notes"],
    streaming: false,
    ...settings,
  });
  const session = await db
    .insertInto("aiChatSessions")
    .values({ userId: user.id, agentId, title: "" })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return { sessionId: session.id, agentId, user };
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
  return Response.json(chatCompletion({ content, tool_calls: toolCalls }, finishReason));
};

const streamedAnswer = (deltas: Record<string, unknown>[]): Response => {
  return new Response(chatCompletionStream(deltas));
};

const decoder = new TextDecoder();

const send = async ({ sessionId, agentId, user }: TestChat, message: string) => {
  const executor = new AgentExecutor({ sessionId, user, message });

  let tokens = "";
  const parts: unknown[] = [];
  let error: unknown;
  try {
    for await (const bytes of executor.executeStream(agentId)) {
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

const answers = ({ sessionId }: TestChat) => {
  return db
    .selectFrom("aiChatMessages")
    .select(["content", "items"])
    .where("sessionId", "=", sessionId)
    .where("role", "=", "assistant")
    .orderBy("createdAt")
    .execute();
};

const executions = ({ sessionId }: TestChat) => {
  return db
    .selectFrom("aiAgentExecutions")
    .select(["status", "errorMessage"])
    .where("sessionId", "=", sessionId)
    .orderBy("createdAt")
    .execute();
};

const tables = ({ sessionId }: TestChat) => {
  return db.selectFrom("aiChatTables").select(["id"]).where("sessionId", "=", sessionId).execute();
};

const roles = (request?: OpenAICompletionRequest): string[] => {
  return (request?.messages ?? []).map((message) => (message.tool_calls ? `${message.role} with tools` : message.role));
};

describe("agent executor", () => {
  it("keeps the tool calls of an answer for the next turns", async () => {
    const chat = await createChat();

    const requests = fakeModel([answer(null, [readNote]), answer("The note says hello.")]);
    const { tokens, parts } = await send(chat, "What does the note a say?");

    expect(tokens).toBe("The note says hello.");
    expect(parts).toEqual([{ type: "tool", id: "call-1", name: "notes_read", description: 'Reads the note "a"' }]);
    expect(requests[1]?.messages.slice(-2)).toMatchObject([
      { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "notes_read" } }] },
      { role: "tool", tool_call_id: "call-1", content: expect.stringContaining("Content of a") as string },
    ]);
    expect(await answers(chat)).toEqual([
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
    await send(chat, "Thanks, bye.");

    expect(roles(nextRequests[0])).toEqual(["system", "user", "assistant with tools", "tool", "assistant", "user"]);
  });

  it("sends the settings of the agent to the model", async () => {
    const chat = await createChat({ temperature: 0.2, maxTokens: 100, reasoningEffort: "low" });

    const requests = fakeModel([answer("Hello.")]);
    await send(chat, "Hi");

    expect(requests[0]).toMatchObject({ temperature: 0.2, max_completion_tokens: 100, reasoning_effort: "low" });
  });

  it("streams an answer with the provider data of its tool calls", async () => {
    const chat = await createChat({ streaming: true });
    const signature = { google: { thought_signature: "signature" } };

    const requests = fakeModel([
      streamedAnswer([{ role: "assistant", tool_calls: [{ ...readNote, index: 0, extra_content: signature }] }]),
      streamedAnswer([{ content: "The note " }, { content: "says hello." }]),
    ]);
    const { tokens } = await send(chat, "What does the note a say?");

    expect(tokens).toBe("The note says hello.");
    expect(requests[1]?.messages.at(-2)).toMatchObject({ tool_calls: [{ id: "call-1", extra_content: signature }] });
    expect((await answers(chat)).map((message) => message.items.map((item) => item.type))).toEqual([
      ["function_call", "function_call_output", "message"],
    ]);
  });

  it("only gives the model the skills that the user can use", async () => {
    const code = "export default async function () { return 1; }";
    const usable = await insertSkill(db, "usable", { code });
    const other = await insertSkill(db, "other", { code });
    await db.insertInto("aiSkillAccess").values({ skillId: usable, userId: bob, role: "user" }).execute();

    const chat = await createChat({ toolProviders: [] }, member);
    await db.insertInto("aiAgentAccess").values({ agentId: chat.agentId, userId: bob, role: "user" }).execute();
    await db
      .insertInto("aiAgentSkills")
      .values([
        { agentId: chat.agentId, skillId: usable },
        { agentId: chat.agentId, skillId: other },
      ])
      .execute();

    const requests = fakeModel([answer("Hello.")]);
    await send(chat, "Hi");

    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toEqual(["skill_usable"]);
  });

  it("drops the tool calls that do not fit in the context", async () => {
    const chat = await createChat({ maxContextChars: 300 });

    fakeModel([answer(null, [readNote]), answer("The note says hello.")]);
    await send(chat, "What does the note a say?");

    const requests = fakeModel([answer("Bye.")]);
    await send(chat, "Thanks, bye.");

    expect(roles(requests[0])).toEqual(["system", "user", "assistant", "user"]);
  });

  it("saves the answer of an agent that finishes on its last iteration", async () => {
    const chat = await createChat({ maxIterations: 1 });

    fakeModel([answer("Hello.")]);
    const { error } = await send(chat, "Hi");

    expect(error).toBeUndefined();
    expect((await answers(chat)).map((message) => message.content)).toEqual(["Hello."]);
  });

  it("keeps an answer without text only when a tool call describes it", async () => {
    const counted = await createChat({ maxIterations: 1 });
    fakeModel([answer(null, [countNotes])]);
    const { error } = await send(counted, "How many notes are there?");

    expect(error).toBeInstanceOf(MaxIterationsError);
    expect(await answers(counted)).toEqual([]);

    const read = await createChat({ maxIterations: 1 });
    fakeModel([answer(null, [readNote])]);
    await send(read, "What does the note a say?");

    expect(await answers(read)).toMatchObject([
      {
        content: "",
        items: [{ type: "function_call", description: 'Reads the note "a"' }, { type: "function_call_output" }],
      },
    ]);
  });

  it("hides the tool calls of an agent that does not show them", async () => {
    const chat = await createChat({ showToolCalls: false });

    fakeModel([answer(null, [readNote]), answer("The note says hello.")]);
    const { parts } = await send(chat, "What does the note a say?");

    expect(parts).toEqual([]);
    expect((await answers(chat)).flatMap((message) => message.items)).toEqual([
      { type: "function_call", call_id: "call-1", name: "notes_read", arguments: '{"note":"a"}' },
      { type: "function_call_output", call_id: "call-1", output: expect.stringContaining("Content of a") as string },
      { type: "message", role: "assistant", content: "The note says hello." },
    ]);
  });

  it("keeps the charts of the tool calls with the answer", async () => {
    const chat = await createChat({ showToolCalls: false });
    const option = { series: [{ type: "bar", data: [3] }] };

    fakeModel([answer(null, [chartNotes]), answer("There are 3 notes.")]);
    const { parts } = await send(chat, "Chart the notes.");

    expect(parts).toEqual([{ type: "chart", name: "Notes", option }]);
    expect((await answers(chat)).flatMap((message) => message.items)).toMatchObject([
      { type: "function_call", name: "notes_chart", parts: [{ type: "chart", name: "Notes", option }] },
      { type: "function_call_output", output: "Shown" },
      { type: "message", content: "There are 3 notes." },
    ]);
  });

  it("stores the tables of the tool calls apart from the answer", async () => {
    const chat = await createChat({ showToolCalls: false });

    fakeModel([answer(null, [listNotes(30)]), answer("There are 30 notes.")]);
    const { parts } = await send(chat, "List the notes.");

    const [part] = parts as ChatTablePart[];
    expect(part).toMatchObject({ type: "table", name: "Notes", columns: ["note"], rowCount: 30 });
    expect(part?.rows).toHaveLength(20);
    expect((await answers(chat)).flatMap((message) => message.items)).toMatchObject([
      { type: "function_call", name: "notes_table", parts: [part] },
      { type: "function_call_output", output: "Shown" },
      { type: "message", content: "There are 30 notes." },
    ]);
    const tableId = part?.id ?? "";
    const notes = Array.from({ length: 30 }, (_, index) => [`note ${String(index)}`]);
    expect(await loadTable(tableId, admin)).toBe(JSON.stringify({ columns: ["note"], rows: notes }));

    // The table goes with its answer
    await db
      .deleteFrom("aiChatMessages")
      .where("sessionId", "=", chat.sessionId)
      .where("role", "=", "assistant")
      .execute();
    expect(await loadTable(tableId, admin)).toBeUndefined();
  });

  it("rejects the tables that exceed the limits", async () => {
    const chat = await createChat();

    const tooManyRows = fakeModel([answer(null, [listNotes(5001)]), answer("There are too many notes.")]);
    expect((await send(chat, "List every note.")).parts).toEqual([]);
    expect(tooManyRows[1]?.messages.at(-1)?.content).toContain("A table cannot have more than 5000 rows");

    const message = await db
      .insertInto("aiChatMessages")
      .values({ sessionId: chat.sessionId, role: "assistant", content: "" })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    await db
      .insertInto("aiChatTables")
      .values({ sessionId: chat.sessionId, messageId: message.id, data: Buffer.from(""), size: 50_000_000 })
      .execute();

    const fullChat = fakeModel([answer(null, [listNotes(1)]), answer("The chat is full.")]);
    expect((await send(chat, "List one note.")).parts).toEqual([]);
    expect(fullChat[1]?.messages.at(-1)?.content).toContain("The tables of a chat cannot have more than");
    expect(await tables(chat)).toHaveLength(1);
  });

  it("discards the tables of the answers that were not saved", async () => {
    const chat = await createChat();
    await db
      .insertInto("aiChatTables")
      .values({ sessionId: chat.sessionId, data: Buffer.from(""), size: 10 })
      .execute();

    fakeModel([answer("Hello.")]);
    await send(chat, "Hi");

    expect(await tables(chat)).toEqual([]);
  });

  it("limits the size of what the tool calls show", async () => {
    const chat = await createChat({ maxToolPartsChars: 1000 });
    const chartManyNotes = (id: string) => {
      return { id, type: "function", function: { name: "notes_chart", arguments: '{"points":300}' } };
    };

    const requests = fakeModel([
      answer(null, [chartManyNotes("call-4"), chartManyNotes("call-5")]),
      answer("That is too much to show."),
    ]);
    const { parts } = await send(chat, "Chart many notes, twice.");

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

  it("hides the tool calls of the specialists from a triage agent", async () => {
    const specialistId = await insertAgent(db, `agent-${crypto.randomUUID()}`, {
      instructions: "Be brief.",
      llmProviderId,
      toolProviders: ["notes"],
      streaming: false,
    });
    const chat = await createChat({ type: "triage", toolProviders: [] });
    await db
      .insertInto("aiTriageSpecialists")
      .values({ triageAgentId: chat.agentId, specialistAgentId: specialistId })
      .execute();
    const route = {
      id: "call-0",
      type: "function",
      function: { name: "route_to_specialist", arguments: JSON.stringify({ specialistId, routingReason: "Notes" }) },
    };

    fakeModel([answer(null, [route]), answer(null, [readNote]), answer("The note says hello.")]);
    await send(chat, "What does the note a say?");

    const requests = fakeModel([answer(null, [route]), answer("Bye.")]);
    await send(chat, "Thanks, bye.");

    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toEqual(["route_to_specialist"]);
    expect(roles(requests[0])).toEqual(["system", "user", "assistant", "user"]);
    expect(roles(requests[1])).toEqual(["system", "user", "assistant with tools", "tool", "assistant", "user"]);
  });

  it("fails the answers that the model declines or leaves unfinished", async () => {
    const chat = await createChat();

    fakeModel([answer(null, undefined, "content_filter")]);
    const declined = await send(chat, "Do something that is not allowed");
    expect(declined.error).toBeInstanceOf(RefusalError);
    expect(await answers(chat)).toHaveLength(0);

    fakeModel([answer("Once upon a", undefined, "length")]);
    const cut = await send(chat, "Tell me a long story");
    expect(cut.error).toBeInstanceOf(MaxOutputTokensError);
    expect(cut.tokens).toBe("Once upon a");
    expect((await answers(chat)).map((row) => row.content)).toEqual(["Once upon a"]);

    expect((await executions(chat)).map((execution) => execution.status)).toEqual(["failed", "failed"]);
  });

  it("cancels the execution when the agent runs out of time", async () => {
    const chat = await createChat({ timeoutSec: 1 });

    vi.stubGlobal("fetch", (_url: URL, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      });
    });
    const late = await send(chat, "Are you there?");
    expect(late.error).toBeInstanceOf(TimeoutError);
    expect(await executions(chat)).toEqual([{ status: "cancelled", errorMessage: "The operation timed out" }]);
  });

  it("cancels the execution when the client stops reading", async () => {
    const chat = await createChat({ streaming: true });

    fakeModel([streamedAnswer([{ content: "One " }, { content: "two " }, { content: "three" }])]);
    const stopped = new AgentExecutor({ sessionId: chat.sessionId, user: admin, message: "Count to three" });
    const stream = stopped.executeStream(chat.agentId);
    await stream.next();
    await stream.return(undefined);
    expect(await executions(chat)).toEqual([{ status: "cancelled", errorMessage: "The operation was aborted" }]);

    fakeModel([streamedAnswer([{ content: "Four" }])]);
    const next = await send(chat, "And the next one?");
    expect(next.error).toBeUndefined();
    expect(next.tokens).toBe("Four");
  });

  it("fails the executions that stopped reporting activity", async () => {
    const chat = await createChat();
    const { sessionId, agentId } = chat;
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
    expect((await executions(chat)).map((row) => row.status)).toEqual(["failed"]);

    fakeModel([answer("Hello again.")]);
    expect((await send(chat, "Hello?")).tokens).toBe("Hello again.");
  });

  it("stores the tool responses as truncated for the model", async () => {
    const chat = await createChat({ maxToolResponseChars: 1000 });
    const exportNotes = { id: "call-4", type: "function", function: { name: "notes_export", arguments: "{}" } };

    const requests = fakeModel([answer(null, [exportNotes]), answer("Exported.")]);
    await send(chat, "Export the notes");

    const sent = requests[1]?.messages.find((message) => message.role === "tool")?.content;
    expect(sent).toContain("[Response truncated: 5000 characters, showing first 1000]");

    const stored = await db
      .selectFrom("aiAgentToolCalls")
      .select(["result"])
      .where("toolName", "=", "notes_export")
      .executeTakeFirstOrThrow();
    expect(stored.result).toBe(sent);
  });

  it("truncates the tool responses to fit in the context", async () => {
    const chat = await createChat({ maxContextChars: 300 });

    const requests = fakeModel([answer(null, [readNote]), answer(null, [readNote]), answer("The note says hello.")]);
    await send(chat, "What does the note a say?");

    const sent = requests[2]?.messages.filter((message) => message.role === "tool").map((message) => message.content);
    expect(sent).toEqual([
      expect.stringContaining("[Response truncated: 614 characters") as string,
      "\n\n[Response truncated: 614 characters, showing first 0]",
    ]);
  });

  it("replaces the characters of tool responses that cannot be stored", async () => {
    const chat = await createChat();
    const scanNotes = { id: "call-5", type: "function", function: { name: "notes_scan", arguments: "{}" } };

    const requests = fakeModel([answer(null, [scanNotes]), answer("Scanned.")]);
    await send(chat, "Scan the note");

    expect(requests[1]?.messages.at(-1)?.content).toBe("Scanned \uFFFD\uFFFD");
    expect((await answers(chat)).map((message) => message.content)).toEqual(["Scanned."]);
  });
});
