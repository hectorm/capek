import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { MCPConnection, MCPConnectionOptions } from "#layers/ai/server/lib/mcp/connection";
import type { MCPToolServer } from "#layers/ai/server/lib/mcp/manager";
import type { MCPTool } from "#layers/ai/shared/mcp";
import type { EndpointInit } from "#layers/core/server/lib/http";
import { createVFS } from "#layers/ai/server/lib/code/generators";
import { executeCode } from "#layers/ai/server/lib/code/interpreter";
import { TimeoutError } from "#layers/ai/server/lib/errors";
import { connect, testConnection } from "#layers/ai/server/lib/mcp/client";
import { PROTOCOL_VERSIONS } from "#layers/ai/server/lib/mcp/connection";
import { MCPManager } from "#layers/ai/server/lib/mcp/manager";
import { decodeRequestBody } from "#layers/ai/tests/unit/helpers/http";
import { fetchEndpoint } from "#layers/core/server/lib/http";

vi.mock("#layers/core/server/lib/http", { spy: true });

const tools = [
  {
    name: "find_files",
    description: "Find files by glob pattern, e.g. src/**/*.ts",
    inputSchema: {
      type: "object",
      properties: { "pattern */ injected": { type: "string", enum: ["**/*.ts", "*/"], default: "**/*" } },
    },
  },
  { name: "screenshot", description: "Take a screenshot", inputSchema: { type: "object", properties: {} } },
  { name: "index", description: "Index a file", inputSchema: { type: "object", properties: {} } },
];

const SERVER_URL = "http://mcp.localhost";
const [MODERN_VERSION] = PROTOCOL_VERSIONS.modern;
const [LEGACY_VERSION] = PROTOCOL_VERSIONS.legacy;

const MODERN_SERVERS = ["/modern", "/dual"];
const MODERN_ONLY_SERVERS = ["/modern", "/future"];

interface Message {
  id?: number;
  method?: string;
  params?: { name?: string; protocolVersion?: string; _meta?: Record<string, unknown> };
}

const requests: { path: string; method: string; headers: Headers; signal?: AbortSignal | null }[] = [];
let listedTools: object[] = tools;
let session: string | null = null;
let sessions = 0;
let finishSlowCall: () => void = () => undefined;
let connecting = Promise.withResolvers();

const interrupted = new Map<string, unknown>();
const clients: MCPConnection[] = [];
const chatSessionIds: string[] = [];

const server = (path: string): MCPToolServer => {
  return { name: "test", url: `${SERVER_URL}/${path}`, headers: [], stateful: false, toolCallTimeoutSec: 5 };
};

const tool = (name: string): MCPTool => {
  return { name, inputSchema: { type: "object" } };
};

const connectClient = async (options: MCPConnectionOptions): Promise<MCPConnection> => {
  const client = await connect(options);
  clients.push(client);
  return client;
};

const createChatSessionId = (): string => {
  const chatSessionId = crypto.randomUUID();
  chatSessionIds.push(chatSessionId);
  return chatSessionId;
};

const sent = (header: string): string[] => {
  return requests.map(({ path, method, headers }) => `${path} ${method} ${headers.get(header) ?? "-"}`);
};

const headerValue = (value: string | null): string | null => {
  const encoded = /^=\?base64\?(.*)\?=$/.exec(value ?? "")?.[1];
  return encoded === undefined ? value : Buffer.from(encoded, "base64").toString();
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
};

const events = (text: string): Response => {
  return new Response(text, { headers: { "Content-Type": "text/event-stream" } });
};

// A stream that carries another message before the response and stays open after it
const stream = (body: unknown): Response => {
  const messages = [{ jsonrpc: "2.0", method: "notifications/progress", params: {} }, body];
  const text = messages.map((message) => `data: ${JSON.stringify(message)}\n\n`).join("");
  return new Response(
    new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode(text));
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
};

const respond = (target: string | URL, init: EndpointInit = {}): Promise<Response> => {
  const { pathname } = new URL(target);
  const message = JSON.parse(decodeRequestBody(init.body) ?? "{}") as Message;
  const headers = new Headers(init.headers);
  requests.push({ path: pathname, method: message.method ?? init.method ?? "", headers, signal: init.signal });

  if (pathname === "/silent" || (pathname === "/pinging" && message.method === undefined && message.id !== undefined)) {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason as Error);
      });
    });
  }
  if (init.method === "GET") {
    if (pathname === "/restless") {
      return Promise.resolve(events("retry: 0\n\n"));
    }
    if (pathname === "/pinging") {
      const pings = [1, 2, 3].map((id) => `data: ${JSON.stringify({ jsonrpc: "2.0", id, method: "ping" })}\n\n`);
      return Promise.resolve(events(pings.join("")));
    }
    const body = interrupted.get(headers.get("Last-Event-ID") ?? "");
    return Promise.resolve(body ? stream(body) : new Response(null, { status: pathname === "/session" ? 404 : 405 }));
  }
  if (pathname === "/expired") {
    return Promise.resolve(new Response(null, { status: 404, headers: { "Mcp-Session-Id": "expired" } }));
  }
  if (pathname === "/broken" || pathname === "/denied") {
    return Promise.resolve(new Response(null, { status: pathname === "/broken" ? 500 : 401 }));
  }

  const refuse = (code: number, data?: unknown, status = 400): Promise<Response> => {
    return Promise.resolve(json({ jsonrpc: "2.0", id: message.id, error: { code, message: "Refused", data } }, status));
  };

  const meta = message.params?._meta;
  if (meta && !MODERN_SERVERS.includes(pathname)) {
    if (pathname === "/future") {
      return refuse(-32022, { supported: ["2099-01-01"] });
    }
    if (pathname === "/late") {
      return connecting.promise.then(() => refuse(-32000));
    }
    return pathname === "/lenient" ? refuse(-32601, undefined, 200) : refuse(-32000);
  }
  if (!meta && MODERN_ONLY_SERVERS.includes(pathname)) {
    return refuse(-32022);
  }
  if (meta) {
    if (
      headers.get("Mcp-Method") !== message.method ||
      headers.get("MCP-Protocol-Version") !== meta["io.modelcontextprotocol/protocolVersion"] ||
      headerValue(headers.get("Mcp-Name")) !== (message.params?.name ?? null)
    ) {
      return refuse(-32020);
    }
    if (meta["io.modelcontextprotocol/clientCapabilities"] === undefined) {
      return refuse(-32602);
    }
  }

  if (pathname === "/session") {
    if (message.method === "initialize") {
      session = `session-${String(++sessions)}`;
    } else if (headers.get("Mcp-Session-Id") !== session) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
  }

  const answer = (result: object): unknown => {
    const typed = meta ? { resultType: "complete", ...result } : result;
    return pathname === "/other" ? {} : { jsonrpc: "2.0", id: message.id, result: typed };
  };
  const reply = (result: object): Promise<Response> => {
    const sessionHeaders: Record<string, string> =
      pathname === "/session" && session ? { "Mcp-Session-Id": session } : {};
    return Promise.resolve(pathname === "/stream" ? stream(answer(result)) : json(answer(result), 200, sessionHeaders));
  };

  if (message.id === undefined) {
    return Promise.resolve(new Response(null, { status: 202 }));
  }
  if (message.method === "initialize") {
    return reply({
      protocolVersion:
        { "/older": "2025-03-26", "/ancient": "2024-11-05" }[pathname] ?? message.params?.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "test", version: "1" },
    });
  }
  if (message.method === "server/discover") {
    return reply({ supportedVersions: [MODERN_VERSION], capabilities: { tools: {} } });
  }
  if (message.method === "tools/list") {
    return reply({ tools: listedTools, nextCursor: pathname === "/endless" ? "more" : undefined });
  }
  if (message.params?.name === "screenshot") {
    return reply({
      content: [
        { type: "text", text: "Screenshot taken" },
        { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        { type: "resource", resource: { uri: "file:///notes.txt", text: "Notes" } },
        { type: "resource_link", uri: "file:///report.pdf", name: "report" },
      ],
    });
  }
  if (message.params?.name === "count") {
    return reply({ structuredContent: { total: 3 } });
  }
  if (message.params?.name === "ask") {
    return reply({ resultType: "input_required", inputRequests: { name: { method: "elicitation/create" } } });
  }
  if (message.params?.name === "queue") {
    return reply({ resultType: "task" });
  }
  if (message.params?.name === "interrupt") {
    const eventId = `event-${String(message.id)}`;
    interrupted.set(eventId, answer({ content: [{ type: "text", text: "resumed" }] }));
    return Promise.resolve(events(`id: ${eventId}\ndata:\n\nretry: 0\n\n`));
  }
  if (message.params?.name === "lose") {
    return Promise.resolve(events("id: lost\ndata:\n\nretry: 0\n\n"));
  }
  if (message.params?.name === "slow") {
    return new Promise((resolve) => {
      finishSlowCall = () => {
        resolve(json(answer({ content: [{ type: "text", text: "done" }] })));
      };
    });
  }
  return reply({ content: [{ type: "text", text: '["src/a.ts"]' }] });
};

beforeAll(() => {
  vi.mocked(fetchEndpoint).mockImplementation(respond);
});

beforeEach(() => {
  requests.length = 0;
  listedTools = tools;
  session = null;
  sessions = 0;
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close();
  }
  for (const chatSessionId of chatSessionIds.splice(0)) {
    await MCPManager.getInstance().cleanupSession(chatSessionId);
  }
});

afterAll(() => {
  vi.mocked(fetchEndpoint).mockReset();
});

describe("MCP manager", () => {
  it("reads the text of a result", async () => {
    const manager = MCPManager.getInstance();
    const chatSessionId = createChatSessionId();
    const call = (toolName: string): Promise<string> => {
      return manager.callTool(server("mcp"), tool(toolName), {}, chatSessionId);
    };

    expect(await call("screenshot")).toBe(
      "Screenshot taken\n[image content omitted: image/png]\nNotes\n[resource_link content omitted: file:///report.pdf]",
    );
    expect(await call("count")).toBe('{"total":3}');
  });

  it("replaces the client of a server whose URL or headers change", async () => {
    const manager = MCPManager.getInstance();
    const chatSessionId = createChatSessionId();

    await manager.callTool(server("mcp"), tool("count"), {}, chatSessionId);
    await manager.callTool(server("rotated"), tool("count"), {}, chatSessionId);
    expect(requests.at(-1)?.path).toBe("/rotated");
  });

  it("does not call a tool whose time is over while it connects", async () => {
    const manager = MCPManager.getInstance();
    const chatSessionId = createChatSessionId();
    connecting = Promise.withResolvers();

    const call = manager.callTool({ ...server("late"), toolCallTimeoutSec: 1 }, tool("count"), {}, chatSessionId);
    await expect(call).rejects.toBeInstanceOf(TimeoutError);
    connecting.resolve(undefined);
    await vi.waitFor(() => {
      expect(requests.map(({ method }) => method)).toContain("notifications/initialized");
    });
    expect(requests.filter(({ method }) => method === "tools/call")).toEqual([]);
  });

  it("keeps the clients of a chat session while one of its calls is running", async () => {
    const manager = MCPManager.getInstance();
    const chatSessionId = createChatSessionId();

    const previousSlowCall = finishSlowCall;
    const call = manager.callTool(server("mcp"), tool("slow"), {}, chatSessionId);
    await vi.waitFor(() => {
      expect(finishSlowCall).not.toBe(previousSlowCall);
    });
    expect(await manager.cleanupIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(0);

    finishSlowCall();
    expect(await call).toBe("done");
    expect(await manager.cleanupIdleSessions(Date.now() + 10 * 60 * 1000)).toBe(0);
    expect(await manager.cleanupIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(1);
  });
});

describe("MCP client", () => {
  it("speaks the newest protocol that a server answers", async () => {
    for (const path of ["modern", "dual", "mcp"]) {
      const client = await connect(server(path));
      expect((await client.listTools()).tools).toHaveLength(tools.length);
      expect(await client.callTool(tool("count"), {})).toMatchObject({ structuredContent: { total: 3 } });
      await client.close();
    }

    expect(sent("MCP-Protocol-Version")).toEqual([
      `/modern server/discover ${MODERN_VERSION}`,
      `/modern tools/list ${MODERN_VERSION}`,
      `/modern tools/call ${MODERN_VERSION}`,
      `/dual server/discover ${MODERN_VERSION}`,
      `/dual tools/list ${MODERN_VERSION}`,
      `/dual tools/call ${MODERN_VERSION}`,
      `/mcp server/discover ${MODERN_VERSION}`,
      `/mcp initialize ${LEGACY_VERSION}`,
      `/mcp notifications/initialized ${LEGACY_VERSION}`,
      `/mcp tools/list ${LEGACY_VERSION}`,
      `/mcp tools/call ${LEGACY_VERSION}`,
    ]);
  });

  it("tries the handshake with a server that speaks none of the modern protocol versions", async () => {
    await (await connect(server("lenient"))).close();
    await expect(connect(server("future"))).rejects.toThrow("400 Bad Request: Refused");

    expect(requests.map(({ path, method }) => `${path} ${method}`)).toEqual([
      "/lenient server/discover",
      "/lenient initialize",
      "/lenient notifications/initialized",
      "/future server/discover",
      "/future initialize",
    ]);
  });

  it("does not try the handshake with a server that fails or rejects the credentials", async () => {
    await expect(connect(server("broken"))).rejects.toThrow("500 Internal Server Error");
    await expect(connect(server("denied"))).rejects.toThrow("401 Unauthorized");

    expect(requests.map(({ path, method }) => `${path} ${method}`)).toEqual([
      "/broken server/discover",
      "/denied server/discover",
    ]);
  });

  it("times out on a server that never responds", async () => {
    const started = Date.now();

    expect(await testConnection({ ...server("other"), timeoutMs: 300 })).toEqual({
      success: false,
      error: "The MCP server did not send a valid JSON-RPC response",
    });
    expect(await testConnection({ ...server("silent"), timeoutMs: 300 })).toEqual({
      success: false,
      error: "The operation was aborted due to timeout",
    });

    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("gives up on a server that keeps failing to list its tools", async () => {
    expect(await testConnection(server("endless"))).toEqual({
      success: false,
      error: "The MCP server lists too many tools",
    });
    expect(await testConnection(server("expired"))).toMatchObject({ success: false });
  });

  it("reads the response of a stream that stays open", async () => {
    const client = await connectClient(server("stream"));

    expect(await client.callTool(tool("count"), {})).toMatchObject({ structuredContent: { total: 3 } });
  });

  it("builds importable modules whatever the names and descriptions of the tools", async () => {
    const client = await connectClient(server("mcp"));
    const { tools: listed } = await client.listTools();

    const binding = {
      id: "1",
      name: "test",
      url: SERVER_URL,
      headers: [],
      stateful: false,
      toolCallTimeoutSec: null,
      tools: listed,
    };
    const vfs = createVFS(
      [binding],
      [
        {
          id: "2",
          name: "glob",
          description: "Match **/*.md */",
          documentation: null,
          parameters: { type: "object" },
          code: "export default async () => 1;",
        },
      ],
    );

    const execution = await executeCode(
      `const servers = await import("/servers/index.js"); const skills = await import("/skills/index.js");
       return [...Object.keys(servers), ...Object.keys(skills)];`,
      {
        chatSessionId: crypto.randomUUID(),
        vfs,
        mcpServers: [binding],
        maxExecutionMs: 10_000,
        maxMemoryBytes: 25 * 1024 * 1024,
      },
    );
    expect(execution.error).toBeNull();
    expect(execution.result).toEqual(["$find_files", "$index_2", "$screenshot", "$glob"]);
  });
});

describe("legacy MCP connection", () => {
  it("declares the protocol version that the server answers the handshake with", async () => {
    const client = await connect(server("older"));
    await client.listTools();
    await client.close();

    expect(requests.map(({ headers }) => headers.get("MCP-Protocol-Version"))).toEqual([
      MODERN_VERSION,
      LEGACY_VERSION,
      "2025-03-26",
      "2025-03-26",
    ]);
  });

  it("rejects a server that answers the handshake with a protocol version that is not spoken", async () => {
    await expect(connect(server("ancient"))).rejects.toThrow(
      'the protocol version "2024-11-05", which is not supported',
    );
  });

  it("keeps the session of a server and starts another when it expires", async () => {
    const client = await connect(server("session"));
    await client.listTools();
    session = null;
    await client.listTools();
    await client.close();

    expect(sent("Mcp-Session-Id")).toEqual([
      "/session server/discover -",
      "/session initialize -",
      "/session notifications/initialized session-1",
      "/session tools/list session-1",
      "/session tools/list session-1",
      "/session initialize -",
      "/session notifications/initialized session-2",
      "/session tools/list session-2",
      "/session DELETE session-2",
    ]);
  });

  it("asks again for the response that a stream ends before", async () => {
    const client = await connectClient(server("mcp"));

    expect(await client.callTool(tool("interrupt"), {})).toMatchObject({ content: [{ text: "resumed" }] });
    expect(sent("Last-Event-ID").at(-1)).toMatch(/^\/mcp GET event-\d+$/);
  });

  it("does not call a tool again when its stream cannot be resumed", async () => {
    const client = await connectClient(server("session"));

    await expect(client.callTool(tool("lose"), {})).rejects.toThrow("did not resume its stream");
    expect(requests.filter(({ method }) => method === "tools/call")).toHaveLength(1);
  });

  it("answers the pings of its stream one at a time, until it closes", async () => {
    const pongs = (): typeof requests => {
      return requests.filter(({ path, method }) => path === "/pinging" && method === "POST");
    };
    const client = await connect({ ...server("pinging"), stateful: true });
    await vi.waitFor(() => {
      expect(pongs()).toHaveLength(1);
    });
    await client.close();

    expect(pongs()).toHaveLength(1);
    expect(pongs()[0]?.signal?.aborted).toBe(true);
  });

  it("waits before reopening the stream of a server that asks for no delay", async () => {
    const streams = (): typeof requests => requests.filter(({ method }) => method === "GET");
    const client = await connect({ ...server("restless"), stateful: true });
    await vi.waitFor(() => {
      expect(streams()).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await client.close();

    expect(streams()).toHaveLength(1);
  });
});

describe("modern MCP connection", () => {
  it("sends the headers of a server, which do not replace the ones of the protocol", async () => {
    const headers = [
      { name: "Authorization", value: "Bearer key" },
      { name: "Mcp-Method", value: "tools/call" },
    ];
    await connectClient({ ...server("modern"), headers });

    expect(sent("Authorization")).toEqual(["/modern server/discover Bearer key"]);
    expect(sent("Mcp-Method")).toEqual(["/modern server/discover server/discover"]);
  });

  it("names the tool that it calls in a header", async () => {
    const client = await connectClient(server("modern"));
    for (const name of ["us-west1", "Hello, 世界", " padded ", "=?base64?literal?="]) {
      await client.callTool(tool(name), {});
    }

    expect(requests.slice(1).map(({ headers }) => headers.get("Mcp-Name"))).toEqual([
      "us-west1",
      "=?base64?SGVsbG8sIOS4lueVjA==?=",
      "=?base64?IHBhZGRlZCA=?=",
      "=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=",
    ]);
  });

  it("sends in headers the parameters that a tool wants in them", async () => {
    const region = { type: "string", "x-mcp-header": "Region" };
    const query: MCPTool = {
      name: "query",
      inputSchema: {
        type: "object",
        properties: {
          region,
          limit: { type: "integer", "x-mcp-header": "Limit" },
          dry: { type: ["boolean", "null"], "x-mcp-header": "Dry-Run" },
          filter: { type: "object", properties: { tenant: { type: "string", "x-mcp-header": "Tenant" } } },
          sql: { type: "string" },
        },
      },
    };
    listedTools = [
      query,
      { name: "repeated", inputSchema: { type: "object", properties: { region, other: { ...region } } } },
      { name: "listed", inputSchema: { type: "object", properties: { regions: { type: "array", items: region } } } },
      { name: "either", inputSchema: { type: "object", anyOf: [{ properties: { region } }] } },
      { name: "spaced", inputSchema: { type: "object", properties: { region: { ...region, "x-mcp-header": "A B" } } } },
      { name: "decimal", inputSchema: { type: "object", properties: { region: { ...region, type: "number" } } } },
    ];

    const client = await connectClient(server("modern"));
    expect((await client.listTools()).tools).toEqual([query]);

    await client.callTool(query, {
      region: "us-west1",
      limit: 10,
      dry: false,
      filter: { tenant: "ácme" },
      sql: "SELECT 1",
    });
    await client.callTool(query, { region: null, sql: "SELECT 1" });

    const params = requests.slice(2).map(({ headers }) => {
      return Object.fromEntries([...headers].filter(([name]) => name.startsWith("mcp-param-")));
    });
    expect(params).toEqual([
      {
        "mcp-param-region": "us-west1",
        "mcp-param-limit": "10",
        "mcp-param-dry-run": "false",
        "mcp-param-tenant": "=?base64?w6FjbWU=?=",
      },
      {},
    ]);
  });

  it("fails on the results that are not complete", async () => {
    const client = await connectClient(server("modern"));

    await expect(client.callTool(tool("ask"), {})).rejects.toThrow('"input_required"');
    await expect(client.callTool(tool("queue"), {})).rejects.toThrow('"task"');
  });

  it("does not ask again for the response that a stream ends before", async () => {
    const client = await connectClient(server("modern"));

    await expect(client.callTool(tool("interrupt"), {})).rejects.toThrow("did not send a valid JSON-RPC response");
    expect(requests.map(({ method }) => method)).toEqual(["server/discover", "tools/call"]);
  });
});
