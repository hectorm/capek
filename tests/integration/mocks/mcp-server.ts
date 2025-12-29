import http from "node:http";

export interface MockMCPServerOptions {
  port: number;
}

interface JSONRPCRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MockMCPServer {
  private server: http.Server | null = null;
  private port: number;
  private sessions = new Set<string>();
  private sessionCounter = 0;

  public constructor(options: MockMCPServerOptions) {
    this.port = options.port;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", reject);
      this.server.listen(this.port, () => {
        console.info(`Mock MCP server listening on port ${String(this.port)}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.info("Mock MCP server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url === "/mcp") {
      this.handleMCP(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  }

  private handleMCP(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId) {
        this.sessions.delete(sessionId);
      }
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      this.handleJSONRPC(body, req, res);
    });
  }

  private handleJSONRPC(body: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    let request: JSONRPCRequest;
    try {
      request = JSON.parse(body) as JSONRPCRequest;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }));
      return;
    }

    let sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (request.method === "initialize") {
      this.sessionCounter++;
      sessionId = `mock-session-${String(this.sessionCounter)}`;
      this.sessions.add(sessionId);
    }

    if (request.method !== "initialize" && sessionId && !this.sessions.has(sessionId)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Session not found" } }),
      );
      return;
    }

    const response = this.processMethod(request);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    res.writeHead(200, headers);
    res.end(JSON.stringify(response));
  }

  private processMethod(request: JSONRPCRequest): JSONRPCResponse {
    switch (request.method) {
      case "initialize":
        return this.handleInitialize(request);
      case "tools/list":
        return this.handleToolsList(request);
      case "tools/call":
        return this.handleToolsCall(request);
      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "Method not found" },
        };
    }
  }

  private handleInitialize(request: JSONRPCRequest): JSONRPCResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "mock-mcp-server",
          version: "1.0.0",
        },
      },
    };
  }

  private handleToolsList(request: JSONRPCRequest): JSONRPCResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: "mock_search",
            description: "A mock search tool for testing",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query",
                },
              },
              required: ["query"],
            },
          },
        ],
      },
    };
  }

  private handleToolsCall(request: JSONRPCRequest): JSONRPCResponse {
    const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const toolName = params?.name ?? "unknown";
    const args = params?.arguments ?? {};

    let resultText: string;
    if (toolName === "mock_search") {
      const query = (args.query as string | undefined) ?? "no query";
      resultText = `Mock search result for: "${query}". This is a test response from the mock MCP server.`;
    } else {
      resultText = `Unknown tool: ${toolName}`;
    }

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
        isError: false,
      },
    };
  }
}
