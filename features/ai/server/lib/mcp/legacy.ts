import { clearTimeout, setTimeout } from "node:timers";

import { z } from "zod/v4";

import type {
  MCPCallOptions,
  MCPConnection,
  MCPConnectionOptions,
  MCPToolList,
} from "#layers/ai/server/lib/mcp/connection";
import type { MCPCallToolResult, MCPTool } from "#layers/ai/shared/mcp";
import { CLIENT_INFO, PROTOCOL_VERSIONS, requestTools } from "#layers/ai/server/lib/mcp/connection";
import { MCPRequestError, notify, request } from "#layers/ai/server/lib/mcp/http";
import { SSEProcessor } from "#layers/ai/server/lib/sse";
import { MCPCallToolResultSchema, McpPingRequestSchema } from "#layers/ai/shared/mcp";
import { fetchEndpoint } from "#layers/core/server/lib/http";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

const SSE_RETRY_MIN_MS = 1_000;
const SSE_RETRY_MAX_MS = 60_000;

const InitializeResultSchema = z.object({
  protocolVersion: z.string(),
});

export class LegacyConnection implements MCPConnection {
  private readonly name: string;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly stateful: boolean;
  private readonly timeoutMs: number | undefined;
  private readonly defaultRetryMs = 3000;
  private _protocolVersion: string = PROTOCOL_VERSIONS.legacy[0];
  private _sessionId: string | null = null;
  private _sseAbortController: AbortController | null = null;
  private _sseReconnectTimeout: NodeJS.Timeout | null = null;
  private _lastEventId: string | null = null;
  private _retryMs: number = this.defaultRetryMs;
  private _isTerminated = false;

  private constructor(options: MCPConnectionOptions) {
    this.name = options.name;
    this.url = options.url;
    this.headers = Object.fromEntries(options.headers.map((h) => [h.name, h.value]));
    this.stateful = options.stateful;
    this.timeoutMs = options.timeoutMs;
  }

  public static async open(options: MCPConnectionOptions): Promise<LegacyConnection> {
    const connection = new LegacyConnection(options);
    try {
      await connection.initialize();
    } catch (error) {
      await connection.close();
      throw error;
    }
    return connection;
  }

  private buildHeaders(options?: { contentType?: string; accept?: string }): Headers {
    const headers = new Headers({
      "MCP-Protocol-Version": this._protocolVersion,
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

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    options: MCPCallOptions = {},
    depth = 0,
  ): Promise<unknown> {
    const sentSessionId = this._sessionId;
    try {
      const { result, headers } = await request(this.url, method, params, {
        headers: this.buildHeaders(),
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
        resumable: true,
      });
      this._sessionId = headers.get("Mcp-Session-Id") ?? this._sessionId;
      return result;
    } catch (error) {
      if (!(error instanceof MCPRequestError) || error.status !== 404 || !sentSessionId || depth >= 2) {
        throw error;
      }

      logger.debug({ serverName: this.name, sessionId: sentSessionId }, "MCP session expired, reinitializing");
      this.resetSessionState();
      await this.initialize();
      return this.rpc(method, params, options, depth + 1);
    }
  }

  private resetSessionState(): void {
    this._protocolVersion = PROTOCOL_VERSIONS.legacy[0];
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

    const retryMs = Math.min(Math.max(this._retryMs, SSE_RETRY_MIN_MS), SSE_RETRY_MAX_MS);
    this._sseReconnectTimeout = setTimeout(() => {
      if (!this._isTerminated) {
        this.startSseStream();
      }
    }, retryMs);
  }

  private async initialize(): Promise<void> {
    const result = await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSIONS.legacy[0],
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });

    const answered = InitializeResultSchema.safeParse(result).data?.protocolVersion;
    const protocolVersion = PROTOCOL_VERSIONS.legacy.find((version) => version === answered);
    if (!protocolVersion) {
      throw new Error(`The MCP server answered with the protocol version "${answered ?? ""}", which is not supported`);
    }
    this._protocolVersion = protocolVersion;

    await notify(
      this.url,
      "notifications/initialized",
      {},
      { headers: this.buildHeaders(), timeoutMs: this.timeoutMs },
    ).catch((error: unknown) => {
      logger.debug({ serverName: this.name, sessionId: this._sessionId, error }, "MCP notification failed");
    });

    logger.debug({ serverName: this.name, url: this.url, sessionId: this._sessionId }, "MCP client initialized");

    if (this.stateful) {
      this.startSseStream();
    }
  }

  public async listTools(): Promise<MCPToolList> {
    const list = await requestTools((params) => this.rpc("tools/list", params));
    logger.debug(
      { serverName: this.name, toolCount: list.tools.length, sessionId: this._sessionId },
      "MCP tools listed",
    );
    return list;
  }

  public async callTool(
    tool: MCPTool,
    args: Record<string, unknown>,
    options: MCPCallOptions = {},
  ): Promise<MCPCallToolResult> {
    const rawResult = await this.rpc("tools/call", { name: tool.name, arguments: args }, options);
    const result = MCPCallToolResultSchema.parse(rawResult);
    logger.debug({ serverName: this.name, toolName: tool.name, sessionId: this._sessionId }, "MCP tool called");
    return result;
  }

  public async close(): Promise<void> {
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
        signal: this.timeoutMs === undefined ? undefined : AbortSignal.timeout(this.timeoutMs),
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
