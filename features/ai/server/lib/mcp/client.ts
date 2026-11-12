import { clearTimeout, setTimeout } from "node:timers";

import { JSONRPCClient } from "json-rpc-2.0";

import type { MCPCallToolResult, MCPTool } from "#layers/ai/shared/mcp";
import type { HttpHeader } from "#layers/core/shared/http";
import type { TestResult } from "#layers/core/shared/types";
import { AbortError, describeError } from "#layers/ai/server/lib/errors";
import { SSEProcessor } from "#layers/ai/server/lib/sse";
import { MCPCallToolResultSchema, MCPListToolsResultSchema, McpPingRequestSchema } from "#layers/ai/shared/mcp";
import { fetchEndpoint, readErrorText } from "#layers/core/server/lib/http";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

export interface MCPClientOptions {
  name: string;
  url: string;
  headers: HttpHeader[];
  stateful: boolean;
  timeoutMs?: number;
}

const REQUEST_TIMEOUT_MS = 30_000;

interface RequestParams {
  signal: AbortSignal;
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class MCPClient {
  public readonly name: string;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly stateful: boolean;
  private readonly timeoutMs: number | null;
  private readonly jsonRpcClient: JSONRPCClient<RequestParams | undefined>;
  private readonly mcpProtocolVersion = "2025-06-18";
  private readonly mcpClientName = "mcp-client";
  private readonly mcpClientVersion = "1.0.0";
  private readonly defaultRetryMs = 3000;
  private _sessionId: string | null = null;
  private _sseAbortController: AbortController | null = null;
  private _sseReconnectTimeout: NodeJS.Timeout | null = null;
  private _lastEventId: string | null = null;
  private _retryMs: number = this.defaultRetryMs;
  private _isTerminated = false;

  public constructor(options: MCPClientOptions) {
    this.name = options.name;
    this.url = options.url;
    this.headers = Object.fromEntries(options.headers.map((h) => [h.name, h.value]));
    this.stateful = options.stateful;
    this.timeoutMs = options.timeoutMs ?? null;
    this.jsonRpcClient = new JSONRPCClient<RequestParams | undefined>(async (jsonRPCRequest, params) => {
      const response = await this.request(jsonRPCRequest, params?.signal);
      if (response != null) {
        this.jsonRpcClient.receive(response as Parameters<typeof this.jsonRpcClient.receive>[0]);
      }
    });
  }

  public get sessionId(): string | null {
    return this._sessionId;
  }

  private buildHeaders(options?: { contentType?: string; accept?: string }): Headers {
    const headers = new Headers({
      "MCP-Protocol-Version": this.mcpProtocolVersion,
    });

    if (options?.contentType) {
      headers.set("Content-Type", options.contentType);
    }

    if (options?.accept) {
      headers.set("Accept", options.accept);
    }

    for (const [key, value] of Object.entries(this.headers)) {
      headers.set(key, value);
    }

    if (this._sessionId) {
      headers.set("Mcp-Session-Id", this._sessionId);
    }

    return headers;
  }

  private async rpc(method: string, params: unknown, options: RequestOptions = {}): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    return this.jsonRpcClient.timeout(timeoutMs).request(method, params, { signal });
  }

  private async request(jsonRPCRequest: unknown, signal?: AbortSignal, depth = 0): Promise<unknown> {
    const headers = this.buildHeaders({
      contentType: "application/json",
      accept: "application/json, text/event-stream",
    });

    const response = await fetchEndpoint(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(jsonRPCRequest),
      signal: signal ?? AbortSignal.timeout(this.timeoutMs ?? REQUEST_TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new Error(describeError(error));
    });

    const newSessionId = response.headers.get("Mcp-Session-Id");
    if (newSessionId) {
      this._sessionId = newSessionId;
    }

    if (!response.ok) {
      if (response.status === 404 && this._sessionId && depth < 2) {
        logger.debug({ serverName: this.name, sessionId: this._sessionId }, "MCP session expired, reinitializing");
        this.resetSessionState();
        try {
          await this.initialize();
          return await this.request(jsonRPCRequest, signal, depth + 1);
        } catch (error) {
          logger.error({ serverName: this.name, sessionId: this._sessionId, error }, "MCP reinitialization failed");
          throw error;
        }
      }

      const errorText = await readErrorText(response);
      throw new Error(`MCP request failed with status ${String(response.status)}: ${errorText}`);
    }

    const contentType = response.headers.get("content-type");

    if (response.status === 202) {
      if (response.body) {
        await response.body.cancel();
      }
      return null;
    }

    if (contentType?.includes("text/event-stream")) {
      if (!response.body) {
        throw new Error("No response body for SSE stream");
      }

      let jsonRpcResponse: unknown = null;
      const reader = response.body.getReader();
      const sse = new SSEProcessor({
        onEvent: (event) => {
          if (event.eventId) {
            this._lastEventId = event.eventId;
          }

          try {
            const chunk: unknown = JSON.parse(event.data);
            if (typeof chunk === "object" && chunk !== null && ("result" in chunk || "error" in chunk)) {
              jsonRpcResponse = chunk;
            }
          } catch (error) {
            logger.debug({ data: event.data, sessionId: this._sessionId, error }, "Failed to parse SSE chunk");
          }
        },
        onRetry: (retryMs) => {
          this._retryMs = retryMs;
        },
      });

      try {
        let result = await reader.read();
        while (!result.done) {
          sse.process(result.value);
          result = await reader.read();
        }
        sse.flush();
      } finally {
        reader.releaseLock();
      }

      if (!jsonRpcResponse) {
        throw new Error("No valid JSON-RPC response in SSE stream");
      }

      return jsonRpcResponse;
    }

    return response.json();
  }

  private resetSessionState(): void {
    this._sessionId = null;
    this._lastEventId = null;
    this._retryMs = this.defaultRetryMs;
  }

  private startSseStream(): void {
    if (this._isTerminated) {
      return;
    }

    this._sseAbortController?.abort();
    this._sseAbortController = new AbortController();

    const signal = this._sseAbortController.signal;
    void this.runSseStream(signal);
  }

  private async sendPingResponse(pingId: string | number): Promise<void> {
    const headers = this.buildHeaders({
      contentType: "application/json",
      accept: "application/json, text/event-stream",
    });

    const pongResponse = {
      jsonrpc: "2.0",
      id: pingId,
      result: {},
    };

    try {
      const response = await fetchEndpoint(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(pongResponse),
      });

      if (!response.ok) {
        logger.warn(
          { serverName: this.name, sessionId: this._sessionId, status: response.status },
          "MCP ping response failed",
        );
      }

      await response.body?.cancel();
    } catch (error) {
      logger.warn({ serverName: this.name, sessionId: this._sessionId, error }, "Failed to send ping response");
    }
  }

  private async runSseStream(signal: AbortSignal): Promise<void> {
    try {
      const headers = this.buildHeaders({
        accept: "text/event-stream",
      });

      if (this._lastEventId) {
        headers.set("Last-Event-ID", this._lastEventId);
      }

      const response = await fetchEndpoint(this.url, {
        method: "GET",
        headers,
        signal,
      });

      if (response.status === 405) {
        logger.debug({ serverName: this.name, sessionId: this._sessionId }, "MCP server does not support SSE stream");
        await response.body?.cancel();
        return;
      }

      if (response.status === 404) {
        await response.body?.cancel();
        logger.debug({ serverName: this.name, sessionId: this._sessionId }, "MCP SSE session not found");
        return;
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Failed to open SSE stream: ${response.statusText}`);
      }

      if (!response.body) {
        return;
      }

      logger.debug({ serverName: this.name, sessionId: this._sessionId }, "MCP SSE stream opened");

      const reader = response.body.getReader();
      const sse = new SSEProcessor({
        onEvent: (event) => {
          if (event.eventId) {
            this._lastEventId = event.eventId;
          }

          if (event.data) {
            try {
              const parsed: unknown = JSON.parse(event.data);
              const ping = McpPingRequestSchema.safeParse(parsed);
              if (ping.success) {
                void this.sendPingResponse(ping.data.id);
              }
            } catch {
              // Ignore non-JSON data
            }
          }
        },
        onRetry: (retryMs) => {
          this._retryMs = retryMs;
        },
      });

      try {
        let result = await reader.read();
        while (!result.done) {
          sse.process(result.value);
          result = await reader.read();
        }
        sse.flush();
      } finally {
        reader.releaseLock();
      }

      if (!this._isTerminated) {
        this.scheduleReconnect();
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      logger.debug({ serverName: this.name, sessionId: this._sessionId, error }, "MCP SSE stream error");

      if (!this._isTerminated) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this._isTerminated) {
      return;
    }

    if (this._sseReconnectTimeout) {
      clearTimeout(this._sseReconnectTimeout);
    }

    this._sseReconnectTimeout = setTimeout(() => {
      if (!this._isTerminated) {
        this.startSseStream();
      }
    }, this._retryMs);
  }

  public async initialize(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new AbortError();
    }

    this._isTerminated = false;

    try {
      await this.rpc(
        "initialize",
        {
          protocolVersion: this.mcpProtocolVersion,
          capabilities: {
            tools: {},
          },
          clientInfo: {
            name: this.mcpClientName,
            version: this.mcpClientVersion,
          },
        },
        { signal },
      );

      this.jsonRpcClient.notify("notifications/initialized", {}, undefined);

      logger.debug({ serverName: this.name, url: this.url, sessionId: this._sessionId }, "MCP client initialized");

      if (this.stateful) {
        this.startSseStream();
      }
    } catch (error) {
      logger.error(
        { serverName: this.name, url: this.url, sessionId: this._sessionId, error },
        "MCP initialization failed",
      );
      throw error;
    }
  }

  public async listTools(signal?: AbortSignal): Promise<MCPTool[]> {
    if (signal?.aborted) {
      throw new AbortError();
    }

    try {
      const allTools: MCPTool[] = [];
      let cursor: string | undefined;

      do {
        if (signal?.aborted) {
          throw new AbortError();
        }

        const rawResult: unknown = await this.rpc("tools/list", cursor ? { cursor } : {}, { signal });
        const result = MCPListToolsResultSchema.safeParse(rawResult);
        if (!result.success) {
          throw new Error(`Failed to parse tools/list response: ${result.error.message}`);
        }
        allTools.push(...result.data.tools);
        cursor = result.data.nextCursor ?? undefined;
      } while (cursor);

      logger.debug(
        { serverName: this.name, toolCount: allTools.length, sessionId: this._sessionId },
        "MCP tools listed",
      );
      return allTools;
    } catch (error) {
      logger.error({ serverName: this.name, sessionId: this._sessionId, error }, "Failed to list MCP tools");
      throw error;
    }
  }

  public async callTool(
    toolName: string,
    args: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<MCPCallToolResult> {
    if (options.signal?.aborted) {
      throw new AbortError();
    }

    try {
      const rawResult: unknown = await this.rpc("tools/call", { name: toolName, arguments: args }, options);
      const result = MCPCallToolResultSchema.parse(rawResult);
      logger.debug({ serverName: this.name, toolName, sessionId: this._sessionId }, "MCP tool called");
      return result;
    } catch (error) {
      logger.error({ serverName: this.name, toolName, sessionId: this._sessionId, error }, "MCP tool call failed");
      throw error;
    }
  }

  public async testConnection(): Promise<TestResult> {
    try {
      await this.initialize();
      await this.listTools();

      logger.debug({ serverName: this.name }, "MCP server test succeeded");
      return { success: true };
    } catch (error) {
      const message = describeError(error);
      logger.warn({ serverName: this.name, error: message }, "MCP server test failed");
      return { success: false, error: message };
    } finally {
      await this.terminate();
    }
  }

  public async terminate(): Promise<void> {
    this._isTerminated = true;

    if (this._sseReconnectTimeout) {
      clearTimeout(this._sseReconnectTimeout);
      this._sseReconnectTimeout = null;
    }

    if (this._sseAbortController) {
      this._sseAbortController.abort();
      this._sseAbortController = null;
    }

    if (!this._sessionId) {
      logger.debug({ serverName: this.name }, "No MCP session to terminate");
      return;
    }

    const headers = this.buildHeaders();

    try {
      const response = await fetchEndpoint(this.url, {
        method: "DELETE",
        headers,
        signal: this.timeoutMs === null ? undefined : AbortSignal.timeout(this.timeoutMs),
      });

      if (response.status === 405) {
        logger.debug(
          { serverName: this.name, sessionId: this._sessionId },
          "MCP server does not support session termination",
        );
      } else if (!response.ok) {
        logger.warn(
          { serverName: this.name, sessionId: this._sessionId, status: response.status },
          "MCP session termination failed",
        );
      } else {
        logger.debug({ serverName: this.name, sessionId: this._sessionId }, "MCP session terminated");
      }
    } catch (error) {
      logger.warn({ serverName: this.name, sessionId: this._sessionId, error }, "MCP session termination failed");
    } finally {
      this.resetSessionState();
    }
  }
}
