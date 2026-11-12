import cluster from "node:cluster";
import { clearTimeout, setTimeout } from "node:timers";

import type { MCPCallToolResult } from "#layers/ai/shared/mcp";
import type { HttpHeader } from "#layers/core/shared/http";
import { AbortError, TimeoutError } from "#layers/ai/server/lib/errors";
import { MCPClient } from "#layers/ai/server/lib/mcp/client";
import { MCPIPCClient } from "#layers/ai/server/lib/mcp/ipc";
import { MCPServerParameters } from "#layers/ai/shared/mcp";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

const IDLE_SESSION_MS = 30 * 60 * 1000;

const mcpResultText = (result: MCPCallToolResult): string => {
  const texts = result.content.map((content) => {
    if (content.type === "text") {
      return content.text ?? "";
    }
    if (content.type === "resource" && typeof content.resource?.text === "string") {
      return content.resource.text;
    }
    const detail = content.mimeType ?? content.uri ?? content.resource?.uri;
    return `[${content.type} content omitted${detail ? `: ${detail}` : ""}]`;
  });

  if (texts.length === 0 && result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }
  return texts.join("\n");
};

const terminateClient = async (serverName: string, client: Promise<MCPClient>): Promise<void> => {
  try {
    await (await client).terminate();
  } catch (error) {
    logger.warn({ error, serverName }, "Failed to terminate MCP client");
  }
};

interface MCPSession {
  clients: Map<string, { config: string; client: Promise<MCPClient> }>;
  calls: number;
  lastUsedAt: number;
}

export class MCPManager {
  private static instance: MCPManager | null = null;
  private static ipcClient: MCPIPCClient | null = null;
  private readonly sessions = new Map<string, MCPSession>();

  private constructor() {}

  static getInstance(): MCPManager {
    if (cluster.isWorker) {
      MCPManager.ipcClient ??= new MCPIPCClient();
    }

    return (MCPManager.instance ??= new MCPManager());
  }

  public async getOrCreateClient(
    serverName: string,
    serverUrl: string,
    serverHeaders: HttpHeader[],
    chatSessionId: string,
    stateful: boolean,
  ): Promise<MCPClient> {
    if (cluster.isWorker) {
      throw new Error("Method not available in worker processes");
    }

    const session = this.sessions.get(chatSessionId) ?? {
      clients: new Map<string, { config: string; client: Promise<MCPClient> }>(),
      calls: 0,
      lastUsedAt: 0,
    };
    session.lastUsedAt = Date.now();
    this.sessions.set(chatSessionId, session);

    const config = JSON.stringify([serverUrl, serverHeaders, stateful]);
    const existing = session.clients.get(serverName);
    if (existing?.config === config) {
      return existing.client;
    }
    if (existing) {
      void terminateClient(serverName, existing.client);
    }

    const client = (async () => {
      const created = new MCPClient({ name: serverName, url: serverUrl, headers: serverHeaders, stateful });
      await created.initialize();
      logger.debug({ serverName, chatSessionId, sessionId: created.sessionId }, "MCP client created for chat session");
      return created;
    })();
    session.clients.set(serverName, { config, client });

    client.catch(() => {
      if (session.clients.get(serverName)?.client === client) {
        session.clients.delete(serverName);
      }
    });

    return client;
  }

  public async cleanupSession(chatSessionId: string): Promise<void> {
    if (cluster.isWorker && MCPManager.ipcClient) {
      await MCPManager.ipcClient.send({ type: "cleanupSession", chatSessionId });
      return;
    }

    const session = this.sessions.get(chatSessionId);
    if (!session) {
      return;
    }

    this.sessions.delete(chatSessionId);

    await Promise.all(
      Array.from(session.clients.entries()).map(([serverName, { client }]) => terminateClient(serverName, client)),
    );

    logger.debug({ chatSessionId, clientCount: session.clients.size }, "MCP session cleaned up");
  }

  public async cleanupIdleSessions(now = Date.now()): Promise<number> {
    if (cluster.isWorker && MCPManager.ipcClient) {
      return (await MCPManager.ipcClient.send({ type: "cleanupIdleSessions" })) as number;
    }

    const idle = Array.from(this.sessions)
      .filter(([, session]) => session.calls === 0 && now - session.lastUsedAt >= IDLE_SESSION_MS)
      .map(([chatSessionId]) => chatSessionId);

    await Promise.all(idle.map((chatSessionId) => this.cleanupSession(chatSessionId)));

    return idle.length;
  }

  public async callTool(
    serverName: string,
    serverUrl: string,
    serverHeaders: HttpHeader[],
    toolName: string,
    args: Record<string, unknown>,
    chatSessionId: string,
    stateful: boolean,
    timeoutSec: number | null,
    signal?: AbortSignal,
  ): Promise<string> {
    const callTimeoutMs = (timeoutSec ?? MCPServerParameters.toolCallTimeoutSec.default) * 1000;

    if (cluster.isWorker && MCPManager.ipcClient) {
      const ipcTimeoutMs = callTimeoutMs + 1000;
      return (await MCPManager.ipcClient.send(
        {
          type: "callTool",
          serverName,
          serverUrl,
          serverHeaders,
          toolName,
          args,
          chatSessionId,
          stateful,
          timeoutSec,
        },
        ipcTimeoutMs,
        signal,
      )) as string;
    }

    const client = this.getOrCreateClient(serverName, serverUrl, serverHeaders, chatSessionId, stateful);
    const session = this.sessions.get(chatSessionId);
    if (session) {
      session.calls++;
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let abortListener: (() => void) | null = null;

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
      };

      const settle = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        fn();
      };

      if (signal) {
        abortListener = () => {
          settle(() => {
            reject(new AbortError());
          });
        };

        if (signal.aborted) {
          reject(new AbortError());
          return;
        }

        signal.addEventListener("abort", abortListener);
      }

      const timeoutId = setTimeout(() => {
        settle(() => {
          reject(new TimeoutError());
        });
      }, callTimeoutMs);

      client
        .then((created) => created.callTool(toolName, args, { signal, timeoutMs: callTimeoutMs }))
        .then(
          (callResult) => {
            settle(() => {
              if (callResult.isError) {
                reject(new Error(`Tool error: ${mcpResultText(callResult)}`));
              } else {
                resolve(mcpResultText(callResult));
              }
            });
          },
          (error: unknown) => {
            settle(() => {
              reject(error instanceof Error ? error : new Error(String(error)));
            });
          },
        );
    }).finally(() => {
      if (session) {
        session.calls--;
        session.lastUsedAt = Date.now();
      }
    });
  }
}
