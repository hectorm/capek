import cluster from "node:cluster";
import { clearTimeout, setTimeout } from "node:timers";

import type { HttpHeader } from "~~/shared/http";
import { AbortError, TimeoutError } from "~~/server/lib/errors";
import { useLogger } from "~~/server/lib/logger";
import { MCPClient } from "~~/server/lib/mcp/client";
import { MCPIPCClient } from "~~/server/lib/mcp/ipc";
import { MCPServerParameters } from "~~/shared/mcp";

const logger = useLogger();

export class MCPManager {
  private static instance: MCPManager | null = null;
  private static ipcClient: MCPIPCClient | null = null;
  private clients = new Map<string, Map<string, MCPClient>>();

  private constructor() {}

  static getInstance(): MCPManager {
    if (cluster.isWorker) {
      MCPManager.ipcClient ??= new MCPIPCClient();
    }

    return (MCPManager.instance ??= new MCPManager());
  }

  public getClient(serverName: string, chatSessionId: string): MCPClient | undefined {
    if (cluster.isWorker) {
      throw new Error("Method not available in worker processes");
    }

    return this.clients.get(chatSessionId)?.get(serverName);
  }

  public hasClient(serverName: string, chatSessionId: string): boolean {
    if (cluster.isWorker) {
      throw new Error("Method not available in worker processes");
    }

    return this.clients.get(chatSessionId)?.has(serverName) ?? false;
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

    let sessions = this.clients.get(chatSessionId);
    if (!sessions) {
      sessions = new Map<string, MCPClient>();
      this.clients.set(chatSessionId, sessions);
    }

    let client = sessions.get(serverName);
    if (client) {
      return client;
    }

    client = new MCPClient({ name: serverName, url: serverUrl, headers: serverHeaders, stateful });
    await client.initialize();
    sessions.set(serverName, client);

    logger.debug({ serverName, chatSessionId, sessionId: client.sessionId }, "MCP client created for chat session");
    return client;
  }

  public async cleanupSession(chatSessionId: string): Promise<void> {
    if (cluster.isWorker && MCPManager.ipcClient) {
      await MCPManager.ipcClient.send({ type: "cleanupSession", chatSessionId });
      return;
    }

    const sessions = this.clients.get(chatSessionId);
    if (!sessions) {
      return;
    }

    await Promise.allSettled(
      Array.from(sessions.values()).map(async (client) => {
        try {
          await client.terminate();
        } catch (error) {
          logger.warn({ error, serverName: client.name }, "Failed to terminate MCP client during cleanup");
        }
      }),
    );

    this.clients.delete(chatSessionId);
    logger.debug({ chatSessionId, clientCount: sessions.size }, "MCP session cleaned up");
  }

  public getTrackedSessionIds(): string[] {
    if (cluster.isWorker) {
      throw new Error("Method not available in worker processes");
    }

    return Array.from(this.clients.keys());
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

    const client = await this.getOrCreateClient(serverName, serverUrl, serverHeaders, chatSessionId, stateful);

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
        if (settled) return;
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

      client.callTool(toolName, args, signal).then(
        (callResult) => {
          settle(() => {
            if (callResult.isError) {
              const errorText = callResult.content.map((c) => c.text).join("\n");
              reject(new Error(`Tool error: ${errorText}`));
            } else {
              resolve(callResult.content.map((c) => c.text).join("\n"));
            }
          });
        },
        (error: unknown) => {
          settle(() => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        },
      );
    });
  }
}
