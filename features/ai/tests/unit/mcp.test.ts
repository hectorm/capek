import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createVFS } from "#layers/ai/server/lib/code/generators";
import { executeCode } from "#layers/ai/server/lib/code/interpreter";
import { MCPClient } from "#layers/ai/server/lib/mcp/client";
import { MCPManager } from "#layers/ai/server/lib/mcp/manager";

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

const url = "http://mcp.localhost";

let finishSlowCall: () => void = () => undefined;

const json = (body: unknown): Response => {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
};

const respond = (target: string, init: RequestInit): Promise<Response> => {
  const { pathname } = new URL(target);
  if (pathname === "/silent") {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason as Error);
      });
    });
  }

  if (pathname === "/expired") {
    return Promise.resolve(new Response(null, { status: 404, headers: { "Mcp-Session-Id": "expired" } }));
  }

  const message = JSON.parse((init.body as string | undefined) ?? "{}") as {
    id?: number;
    method?: string;
    params?: { name?: string };
  };
  const reply = (result: unknown): Promise<Response> => {
    return Promise.resolve(json(pathname === "/other" ? {} : { jsonrpc: "2.0", id: message.id, result }));
  };

  if (message.id === undefined) {
    return Promise.resolve(new Response(null, { status: 202 }));
  }
  if (message.method === "initialize") {
    return reply({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "test", version: "1" },
    });
  }
  if (message.method === "tools/list") {
    return reply({ tools, nextCursor: pathname === "/endless" ? "more" : undefined });
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
  if (message.params?.name === "slow") {
    return new Promise((resolve) => {
      finishSlowCall = () => {
        resolve(json({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "done" }] } }));
      };
    });
  }
  return reply({ content: [{ type: "text", text: '["src/a.ts"]' }] });
};

beforeAll(() => {
  vi.stubGlobal("fetch", respond);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("MCP client", () => {
  it("reads the text of a result", async () => {
    const manager = MCPManager.getInstance();
    const chatSessionId = crypto.randomUUID();
    const call = (toolName: string): Promise<string> => {
      return manager.callTool("test", `${url}/mcp`, [], toolName, {}, chatSessionId, false, 5);
    };

    expect(await call("screenshot")).toBe(
      "Screenshot taken\n[image content omitted: image/png]\nNotes\n[resource_link content omitted: file:///report.pdf]",
    );
    expect(await call("count")).toBe('{"total":3}');

    await manager.cleanupSession(chatSessionId);
  });

  it("replaces the client of a server whose URL or headers change", async () => {
    const manager = MCPManager.getInstance();
    const chatSessionId = crypto.randomUUID();

    const paths: string[] = [];
    vi.stubGlobal("fetch", (target: string, init: RequestInit) => {
      paths.push(new URL(target).pathname);
      return respond(target, init);
    });

    await manager.callTool("test", `${url}/mcp`, [], "count", {}, chatSessionId, false, 5);
    await manager.callTool("test", `${url}/rotated`, [], "count", {}, chatSessionId, false, 5);
    expect(paths.at(-1)).toBe("/rotated");

    vi.stubGlobal("fetch", respond);
    await manager.cleanupSession(chatSessionId);
  });

  it("keeps the clients of a chat session while one of its calls is running", async () => {
    const manager = MCPManager.getInstance();
    const chatSessionId = crypto.randomUUID();

    const previousSlowCall = finishSlowCall;
    const call = manager.callTool("test", `${url}/mcp`, [], "slow", {}, chatSessionId, false, 5);
    await vi.waitFor(() => {
      expect(finishSlowCall).not.toBe(previousSlowCall);
    });
    expect(await manager.cleanupIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(0);

    finishSlowCall();
    expect(await call).toBe("done");
    expect(await manager.cleanupIdleSessions(Date.now() + 10 * 60 * 1000)).toBe(0);
    expect(await manager.cleanupIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(1);
  });

  it("times out on a server that never responds", async () => {
    const started = Date.now();

    const other = new MCPClient({ name: "other", url: `${url}/other`, headers: [], stateful: false, timeoutMs: 300 });
    expect(await other.testConnection()).toMatchObject({ success: false });

    const silent = new MCPClient({
      name: "silent",
      url: `${url}/silent`,
      headers: [],
      stateful: false,
      timeoutMs: 300,
    });
    expect(await silent.testConnection()).toMatchObject({ success: false });

    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("gives up on a server that keeps failing to list its tools", async () => {
    const endless = new MCPClient({ name: "endless", url: `${url}/endless`, headers: [], stateful: false });
    expect(await endless.testConnection()).toEqual({ success: false, error: "The MCP server lists too many tools" });

    const expired = new MCPClient({ name: "expired", url: `${url}/expired`, headers: [], stateful: false });
    expect(await expired.testConnection()).toMatchObject({ success: false });
  });

  it("waits before reopening the stream of a server that asks for no delay", async () => {
    let streams = 0;
    vi.stubGlobal("fetch", (target: string, init: RequestInit) => {
      if (init.method !== "GET") {
        return respond(target, init);
      }
      streams++;
      return Promise.resolve(new Response("retry: 0\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    });

    const client = new MCPClient({ name: "test", url: `${url}/mcp`, headers: [], stateful: true });
    await client.initialize();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await client.terminate();
    vi.stubGlobal("fetch", respond);

    expect(streams).toBe(1);
  });

  it("builds importable modules whatever the names and descriptions of the tools", async () => {
    const client = new MCPClient({ name: "test", url: `${url}/mcp`, headers: [], stateful: false });
    await client.initialize();
    const listed = await client.listTools();

    const binding = {
      id: "1",
      name: "test",
      url,
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
