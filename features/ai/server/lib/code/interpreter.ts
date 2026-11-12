import { clearTimeout, setTimeout } from "node:timers";
import { Worker } from "node:worker_threads";

import { newQuickJSAsyncWASMModuleFromVariant } from "quickjs-emscripten-core";

import type { MCPServerBinding } from "#layers/ai/server/lib/code/generators";
import type {
  ConsoleLog,
  SandboxHostFunction,
  SandboxInput,
  SandboxMessage,
  SandboxReply,
} from "#layers/ai/server/lib/code/protocol";
import type { VirtualFileSystem } from "#layers/ai/server/lib/code/vfs";
import type { AgentToolset } from "#layers/ai/server/lib/tools";
import type { ToolContext } from "#layers/core/server/lib/tools/define";
import { AbortError } from "#layers/ai/server/lib/errors";
import { MCPManager } from "#layers/ai/server/lib/mcp/manager";
import { findAgentTool, truncate } from "#layers/ai/server/lib/tools";
import { useLogger } from "#layers/core/server/lib/logger";

export type { ConsoleLog } from "#layers/ai/server/lib/code/protocol";

export interface MCPCallLog {
  serverName: string;
  toolName: string;
  args: string;
  result: string | null;
  error: string | null;
  durationMs: number;
}

export interface ToolCallLog {
  provider: string;
  toolName: string;
  args: string;
  result: string | null;
  error: string | null;
  durationMs: number;
}

export interface ExecutionResult {
  result: unknown;
  consoleLogs: ConsoleLog[];
  mcpCallLogs: MCPCallLog[];
  toolCallLogs: ToolCallLog[];
  error: string | null;
  executionMs: number;
}

export interface ExecuteCodeOptions {
  chatSessionId: string;
  vfs: VirtualFileSystem;
  mcpServers: MCPServerBinding[];
  tools?: { toolsets: AgentToolset[]; context: ToolContext };
  maxExecutionMs: number;
  maxMemoryBytes: number;
  maxWorkspaceBytes?: number;
  maxCallLogChars?: number;
  signal?: AbortSignal;
}

const logger = useLogger();

const WORKER_GRACE_MS = 2_000;
const WORKER_MAX_HEAP_MB = 256;
const MAX_HOST_CALLS = 1_000;
const MAX_CONCURRENT_SANDBOXES = 8;

let activeSandboxes = 0;
const queuedSandboxes: (() => void)[] = [];

const acquireSandbox = async (signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    throw new AbortError();
  }
  if (activeSandboxes < MAX_CONCURRENT_SANDBOXES) {
    activeSandboxes++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const start = (): void => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => {
      queuedSandboxes.splice(queuedSandboxes.indexOf(start), 1);
      reject(new AbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    queuedSandboxes.push(start);
  });
};

const releaseSandbox = (): void => {
  const next = queuedSandboxes.shift();
  if (next) {
    next();
  } else {
    activeSandboxes--;
  }
};

type AsyncWASMModule = Awaited<ReturnType<typeof newQuickJSAsyncWASMModuleFromVariant>>;
let cachedModulePromise: Promise<AsyncWASMModule> | null = null;

export async function getQuickJSModule(): Promise<AsyncWASMModule> {
  cachedModulePromise ??= (async () => {
    const variant = await import("@jitl/quickjs-wasmfile-release-asyncify");
    return newQuickJSAsyncWASMModuleFromVariant(variant.default);
  })();
  return cachedModulePromise;
}

type SandboxDone = Extract<SandboxMessage, { type: "done" }>;

const runSandbox = (
  input: SandboxInput,
  callHost: (name: SandboxHostFunction, args: string[], signal: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
): Promise<SandboxDone> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }

    const worker = new Worker(new URL("./sandbox.worker.ts", import.meta.url), {
      name: "ai-sandbox",
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_HEAP_MB },
    });

    const calls = new AbortController();
    let settled = false;

    const settle = (complete: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      calls.abort();
      void worker.terminate();
      complete();
    };

    const onAbort = (): void => {
      settle(() => {
        reject(new AbortError());
      });
    };
    signal?.addEventListener("abort", onAbort);

    const timeout = setTimeout(() => {
      settle(() => {
        reject(new Error("Execution timeout"));
      });
    }, input.maxExecutionMs + WORKER_GRACE_MS);

    worker.on("message", (message: SandboxMessage) => {
      if (message.type === "done") {
        settle(() => {
          resolve(message);
        });
        return;
      }

      const { id } = message;
      const reply = (answer: SandboxReply): void => {
        if (!settled) {
          worker.postMessage(answer);
        }
      };
      callHost(message.name, message.args, calls.signal).then(
        (value) => {
          reply({ id, value });
        },
        (err: unknown) => {
          reply({ id, error: err instanceof Error ? err.message : String(err) });
        },
      );
    });

    worker.on("error", (err: unknown) => {
      settle(() => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

    worker.on("exit", () => {
      settle(() => {
        reject(new Error("The code stopped unexpectedly"));
      });
    });
  });
};

const parseArgs = (name: string, argsJson: string | undefined): Record<string, unknown> => {
  try {
    return JSON.parse(argsJson ?? "{}") as Record<string, unknown>;
  } catch (error) {
    logger.warn({ name, argsJson, error }, "Failed to parse the arguments of a call from the code interpreter");
    return {};
  }
};

export async function executeCode(code: string, options: ExecuteCodeOptions): Promise<ExecutionResult> {
  const startTime = Date.now();
  const mcpCallLogs: MCPCallLog[] = [];
  const toolCallLogs: ToolCallLog[] = [];
  let callLogChars = options.maxCallLogChars ?? Infinity;
  const keepInLog = (text: string): string => {
    const kept = truncate(text, callLogChars);
    callLogChars = Math.max(callLogChars - text.length, 0);
    return kept;
  };
  let hostCalls = 0;

  const callMcp = async (signal: AbortSignal, serverName = "", toolName = "", argsJson?: string): Promise<string> => {
    const args = parseArgs(toolName, argsJson);

    const server = options.mcpServers.find((s) => s.name === serverName);
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const callStart = Date.now();
    try {
      const output = await MCPManager.getInstance().callTool(
        server.name,
        server.url,
        server.headers,
        toolName,
        args,
        options.chatSessionId,
        server.stateful,
        server.toolCallTimeoutSec,
        signal,
      );
      mcpCallLogs.push({
        serverName,
        toolName,
        args: keepInLog(argsJson ?? "{}"),
        result: keepInLog(output),
        error: null,
        durationMs: Date.now() - callStart,
      });
      return output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mcpCallLogs.push({
        serverName,
        toolName,
        args: keepInLog(argsJson ?? "{}"),
        result: null,
        error: message,
        durationMs: Date.now() - callStart,
      });
      throw new Error(message);
    }
  };

  const callTool = async (signal: AbortSignal, toolName = "", argsJson?: string): Promise<string> => {
    const args = parseArgs(toolName, argsJson);

    const found = options.tools && findAgentTool(options.tools.toolsets, toolName);
    if (!options.tools || !found) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    const { provider, tool } = found;

    const callStart = Date.now();
    try {
      const output = await tool.execute(args, { ...options.tools.context, signal });
      toolCallLogs.push({
        provider,
        toolName,
        args: keepInLog(argsJson ?? "{}"),
        result: keepInLog(output),
        error: null,
        durationMs: Date.now() - callStart,
      });
      return output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolCallLogs.push({
        provider,
        toolName,
        args: keepInLog(argsJson ?? "{}"),
        result: null,
        error: message,
        durationMs: Date.now() - callStart,
      });
      throw new Error(message);
    }
  };

  let outcome: Pick<ExecutionResult, "result" | "consoleLogs" | "error">;
  try {
    await acquireSandbox(options.signal);
    const done = await runSandbox(
      {
        code,
        files: options.vfs.toJSON(),
        maxExecutionMs: options.maxExecutionMs,
        maxMemoryBytes: options.maxMemoryBytes,
        maxWorkspaceBytes: options.maxWorkspaceBytes,
      },
      (name, args, signal) => {
        if (++hostCalls > MAX_HOST_CALLS) {
          return Promise.reject(new Error(`The code cannot call tools more than ${String(MAX_HOST_CALLS)} times`));
        }
        return name === "mcp" ? callMcp(signal, ...args) : callTool(signal, ...args);
      },
      options.signal,
    ).finally(releaseSandbox);

    options.vfs.setWorkspaceFiles(done.workspace);
    outcome = { result: done.result, consoleLogs: done.consoleLogs, error: done.error };
  } catch (err) {
    outcome = { result: null, consoleLogs: [], error: err instanceof Error ? err.message : String(err) };
  }

  if (outcome.error !== null) {
    logger.warn({ error: outcome.error, codeLength: code.length }, "Code execution failed");
  }

  return { ...outcome, mcpCallLogs, toolCallLogs, executionMs: Date.now() - startTime };
}
