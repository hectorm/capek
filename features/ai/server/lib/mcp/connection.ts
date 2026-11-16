import type { MCPCallToolResult, MCPTool } from "#layers/ai/shared/mcp";
import type { HttpHeader } from "#layers/core/shared/http";
import { MCPListToolsResultSchema } from "#layers/ai/shared/mcp";

const TOOLS_MAX = 1_000;
const TOOLS_MAX_PAGES = 20;

export const CLIENT_INFO = { name: "mcp-client", version: "1.0.0" };

export const PROTOCOL_VERSIONS = {
  modern: ["2026-07-28"],
  legacy: ["2025-11-25", "2025-06-18", "2025-03-26"],
} as const;

export interface MCPServer {
  name: string;
  url: string;
  headers: HttpHeader[];
  stateful: boolean;
}

export interface MCPConnectionOptions extends MCPServer {
  timeoutMs?: number;
}

export interface MCPCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MCPToolList {
  tools: MCPTool[];
  ttlMs: number;
}

export interface MCPConnection {
  listTools: () => Promise<MCPToolList>;
  callTool: (tool: MCPTool, args: Record<string, unknown>, options?: MCPCallOptions) => Promise<MCPCallToolResult>;
  close: () => Promise<void>;
}

export const requestTools = async (
  requestPage: (params: { cursor?: string }) => Promise<unknown>,
): Promise<MCPToolList> => {
  const tools: MCPTool[] = [];
  let ttlMs = Infinity;
  let cursor: string | undefined;
  let pages = 0;

  do {
    const page = MCPListToolsResultSchema.safeParse(await requestPage(cursor ? { cursor } : {}));
    if (!page.success) {
      throw new Error(`Failed to parse tools/list response: ${page.error.message}`);
    }
    if (tools.length + page.data.tools.length > TOOLS_MAX || ++pages > TOOLS_MAX_PAGES) {
      throw new Error("The MCP server lists too many tools");
    }
    tools.push(...page.data.tools);
    ttlMs = Math.min(ttlMs, page.data.ttlMs ?? 0);
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor);

  return { tools, ttlMs };
};
