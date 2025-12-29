import cluster from "node:cluster";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { setTimeout } from "node:timers";

import type { HttpHeader } from "~~/shared/http";
import { AbortError } from "~~/server/lib/errors";
import { useLogger } from "~~/server/lib/logger";
import { MCPManager } from "~~/server/lib/mcp/manager";

const logger = useLogger();

export interface MCPIPCRequest {
  type: "callTool" | "cancelToolCall" | "cleanupSession";
  requestId: string;
  serverName?: string;
  serverUrl?: string;
  serverHeaders?: HttpHeader[];
  toolName?: string;
  args?: Record<string, unknown>;
  chatSessionId?: string;
  stateful?: boolean;
  timeoutSec?: number | null;
}

export interface MCPIPCResponse {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export class MCPIPCClient {
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  public constructor() {
    if (cluster.isWorker) {
      process.on("message", (response: MCPIPCResponse) => {
        const pending = this.pendingRequests.get(response.requestId);
        if (!pending) return;

        this.pendingRequests.delete(response.requestId);
        if (response.success) {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.error));
        }
      });
    }
  }

  public async send(
    request: Omit<MCPIPCRequest, "requestId">,
    timeoutMs = 60000,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!process.send) {
      throw new Error("IPC not available: process.send is undefined");
    }

    const requestId = randomUUID();
    const fullRequest: MCPIPCRequest = { ...request, requestId } as MCPIPCRequest;
    const sendFn = process.send.bind(process);

    return new Promise((resolve, reject) => {
      let abortListener: (() => void) | null = null;

      const cleanup = () => {
        this.pendingRequests.delete(requestId);
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
      };

      if (signal) {
        abortListener = () => {
          cleanup();
          sendFn({ type: "cancelToolCall", requestId } as MCPIPCRequest);
          reject(new AbortError());
        };

        if (signal.aborted) {
          abortListener();
          return;
        }

        signal.addEventListener("abort", abortListener);
      }

      this.pendingRequests.set(requestId, {
        resolve: (value: unknown) => {
          cleanup();
          resolve(value);
        },
        reject: (error: Error) => {
          cleanup();
          reject(error);
        },
      });

      sendFn(fullRequest);

      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          cleanup();
          reject(new Error(`MCP IPC request timeout after ${String(timeoutMs)}ms`));
        }
      }, timeoutMs);
    });
  }
}

export function setupMCPIPCHandler(): void {
  if (!cluster.isPrimary) return;

  const manager = MCPManager.getInstance();
  const activeToolCalls = new Map<string, AbortController>();

  cluster.on("message", (worker, message: unknown) => {
    if (message == null || typeof message !== "object" || !("type" in message) || !("requestId" in message)) {
      return;
    }

    const request = message as MCPIPCRequest;

    void (async () => {
      try {
        let data: unknown;
        switch (request.type) {
          case "callTool": {
            if (
              request.serverName === undefined ||
              request.serverUrl === undefined ||
              request.serverHeaders === undefined ||
              request.toolName === undefined ||
              request.args === undefined ||
              request.chatSessionId === undefined ||
              request.stateful === undefined ||
              request.timeoutSec === undefined
            ) {
              throw new Error("Missing required arguments for callTool request");
            }
            const abortController = new AbortController();
            activeToolCalls.set(request.requestId, abortController);
            try {
              data = await manager.callTool(
                request.serverName,
                request.serverUrl,
                request.serverHeaders,
                request.toolName,
                request.args,
                request.chatSessionId,
                request.stateful,
                request.timeoutSec,
                abortController.signal,
              );
            } finally {
              activeToolCalls.delete(request.requestId);
            }
            break;
          }
          case "cleanupSession": {
            if (request.chatSessionId === undefined) {
              throw new Error("Missing required arguments for cleanupSession request");
            }
            await manager.cleanupSession(request.chatSessionId);
            data = null;
            break;
          }
          case "cancelToolCall": {
            const controller = activeToolCalls.get(request.requestId);
            if (controller) {
              controller.abort();
              logger.debug({ requestId: request.requestId }, "Tool call cancelled via IPC");
            }
            data = null;
            break;
          }
          default: {
            throw new Error(`Unknown MCP IPC request type: ${String(request.type)}`);
          }
        }
        worker.send({
          requestId: request.requestId,
          success: true,
          data,
        } satisfies MCPIPCResponse);
      } catch (error) {
        worker.send({
          requestId: request.requestId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies MCPIPCResponse);
      }
    })();
  });
}
