import { setTimeout } from "node:timers/promises";

import type { QuickJSAsyncContext, QuickJSAsyncRuntime, QuickJSContext, QuickJSHandle } from "quickjs-emscripten-core";
import { newQuickJSAsyncWASMModuleFromVariant, Scope } from "quickjs-emscripten-core";

import type { MCPServerBinding } from "~~/server/lib/code/generators";
import type { VirtualFileSystem } from "~~/server/lib/code/vfs";
import { useLogger } from "~~/server/lib/logger";
import { MCPManager } from "~~/server/lib/mcp/manager";

export interface ConsoleLog {
  level: "log" | "warn" | "error" | "debug" | "info";
  args: unknown[];
  timestamp: number;
}

export interface MCPCallLog {
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  result: string | null;
  error: string | null;
  durationMs: number;
}

export interface ExecutionResult {
  result: unknown;
  consoleLogs: ConsoleLog[];
  mcpCallLogs: MCPCallLog[];
  error: string | null;
  executionMs: number;
}

export interface ExecuteCodeOptions {
  chatSessionId: string;
  vfs: VirtualFileSystem;
  mcpServers: MCPServerBinding[];
  maxExecutionMs: number;
  maxMemoryBytes: number;
  signal?: AbortSignal;
}

const logger = useLogger();

type AsyncWASMModule = Awaited<ReturnType<typeof newQuickJSAsyncWASMModuleFromVariant>>;
let cachedModulePromise: Promise<AsyncWASMModule> | null = null;

export async function getQuickJSModule(): Promise<AsyncWASMModule> {
  cachedModulePromise ??= (async () => {
    const variant = await import("@jitl/quickjs-wasmfile-release-asyncify");
    return newQuickJSAsyncWASMModuleFromVariant(variant.default as never);
  })();
  return cachedModulePromise;
}

export async function executeCode(code: string, options: ExecuteCodeOptions): Promise<ExecutionResult> {
  const startTime = Date.now();
  const deadline = startTime + options.maxExecutionMs;
  const consoleLogs: ConsoleLog[] = [];
  const mcpCallLogs: MCPCallLog[] = [];
  let result: unknown = null;
  let error: string | null = null;

  try {
    result = await Scope.withScopeAsync(async (scope) => {
      const quickJS = await getQuickJSModule();
      const runtime = scope.manage(quickJS.newRuntime());

      runtime.setMemoryLimit(options.maxMemoryBytes);
      runtime.setInterruptHandler(() => Date.now() > deadline || options.signal?.aborted === true);

      setupModuleLoader(runtime, options.vfs);

      const context = scope.manage(runtime.newContext());
      const pendingCalls: Promise<void>[] = [];

      setupConsoleAPI(context, scope, consoleLogs);
      setupFsAPI(context, scope, options.vfs, pendingCalls);
      setupMCPCall(context, scope, options, mcpCallLogs, pendingCalls);

      const wrappedCode = `(async () => { ${code} })()`;
      const evalResult = await context.evalCodeAsync(wrappedCode);
      if (evalResult.error) {
        throw new Error(extractError(context, scope.manage(evalResult.error)));
      }

      const promiseHandle = scope.manage(evalResult.value);

      // Poll until the promise resolves
      while (Date.now() <= deadline) {
        runtime.executePendingJobs();

        const promiseState = context.getPromiseState(promiseHandle);
        if (promiseState.type === "fulfilled") {
          await Promise.all(pendingCalls);
          return marshallFromQuickJS(context, scope.manage(promiseState.value));
        }
        if (promiseState.type === "rejected") {
          await Promise.all(pendingCalls);
          throw new Error(extractError(context, scope.manage(promiseState.error)));
        }

        await setTimeout(10);
      }
      throw new Error("Execution timeout");
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.warn({ error, codeLength: code.length }, "Code execution failed");
  }

  return { result, consoleLogs, mcpCallLogs, error, executionMs: Date.now() - startTime };
}

function extractError(context: QuickJSContext, handle: QuickJSHandle): string {
  const errorObj = context.dump(handle) as Record<string, unknown> | string | null;
  if (typeof errorObj === "object" && errorObj && "message" in errorObj) {
    return String(errorObj.message);
  }
  return typeof errorObj === "string" ? errorObj : "Unknown error";
}

function setupModuleLoader(runtime: QuickJSAsyncRuntime, vfs: VirtualFileSystem): void {
  runtime.setModuleLoader(
    (modulePath: string) => {
      const content = vfs.readFile(modulePath);
      if (content === null) {
        throw new Error(`Module not found: ${modulePath}`);
      }
      return content;
    },
    (baseModulePath: string, requestedName: string) => {
      return vfs.normalizePath(requestedName.startsWith("/") ? requestedName : baseModulePath + "/../" + requestedName);
    },
  );
}

function setupConsoleAPI(context: QuickJSAsyncContext, scope: Scope, consoleLogs: ConsoleLog[]): void {
  const consoleObj = scope.manage(context.newObject());
  const levels = ["log", "warn", "error", "debug", "info"] as const;

  for (const level of levels) {
    const fn = scope.manage(
      context.newFunction(level, (...args: QuickJSHandle[]) => {
        consoleLogs.push({
          level,
          args: args.map((arg) => marshallFromQuickJS(context, arg)),
          timestamp: Date.now(),
        });
      }),
    );
    context.setProp(consoleObj, level, fn);
  }
  context.setProp(context.global, "console", consoleObj);
}

function setupFsAPI(
  context: QuickJSAsyncContext,
  scope: Scope,
  vfs: VirtualFileSystem,
  pendingCalls: Promise<void>[],
): void {
  const fsObj = scope.manage(context.newObject());
  const promisesObj = scope.manage(context.newObject());

  const checkWritePermission = (path: string): string | null => {
    const normalized = path.startsWith("/") ? path : "/" + path;
    if (!normalized.startsWith("/workspace/") && normalized !== "/workspace") {
      return `EACCES: permission denied (only /workspace/ is writable)`;
    }
    return null;
  };

  const register = (name: string, fn: (...args: QuickJSHandle[]) => QuickJSHandle) => {
    const syncFn = scope.manage(context.newFunction(name + "Sync", fn));
    context.setProp(fsObj, name + "Sync", syncFn);

    const asyncFn = scope.manage(
      context.newFunction(name, (...args: QuickJSHandle[]) => {
        const promise = context.newPromise();
        try {
          const result = fn(...args);
          promise.resolve(result);
          if (result !== context.undefined && result !== context.true && result !== context.false) {
            result.dispose();
          }
        } catch (err) {
          const error = context.newError(err instanceof Error ? err.message : String(err));
          promise.reject(error);
          error.dispose();
        }
        pendingCalls.push(promise.settled.then(() => void context.runtime.executePendingJobs()));
        return promise.handle;
      }),
    );
    context.setProp(promisesObj, name, asyncFn);
  };

  register("exists", (pathH) => {
    const path = context.getString(pathH);
    return marshallToQuickJS(context, vfs.exists(path));
  });

  register("stat", (pathH) => {
    const path = context.getString(pathH);
    const stats = vfs.stat(path);
    if (!stats) throw new Error(`ENOENT: no such file, stat '${path}'`);
    return marshallToQuickJS(context, stats);
  });

  register("readFile", (pathH) => {
    const path = context.getString(pathH);
    const content = vfs.readFile(path);
    if (content === null) throw new Error(`ENOENT: no such file, open '${path}'`);
    return marshallToQuickJS(context, content);
  });

  register("readdir", (pathH) => {
    const path = context.getString(pathH);
    const entries = vfs.readdir(path);
    if (entries === null) throw new Error(`ENOENT: no such directory, scandir '${path}'`);
    return marshallToQuickJS(context, entries);
  });

  register("glob", (patternH) => {
    const pattern = context.getString(patternH);
    return marshallToQuickJS(context, vfs.glob(pattern));
  });

  register("mkdir", (pathH) => {
    const path = context.getString(pathH);
    const permErr = checkWritePermission(path);
    if (permErr) throw new Error(permErr);
    if (!vfs.mkdir(path)) throw new Error(`EEXIST: already exists, mkdir '${path}'`);
    return context.undefined;
  });

  register("writeFile", (pathH, dataH) => {
    const path = context.getString(pathH);
    const permErr = checkWritePermission(path);
    if (permErr) throw new Error(permErr);
    vfs.writeFile(path, context.getString(dataH));
    return context.undefined;
  });

  register("appendFile", (pathH, dataH) => {
    const path = context.getString(pathH);
    const permErr = checkWritePermission(path);
    if (permErr) throw new Error(permErr);
    vfs.appendFile(path, context.getString(dataH));
    return context.undefined;
  });

  register("copyFile", (srcH, destH) => {
    const src = context.getString(srcH);
    const dest = context.getString(destH);
    const permErr = checkWritePermission(dest);
    if (permErr) throw new Error(permErr);
    if (!vfs.copyFile(src, dest)) throw new Error(`ENOENT: copyFile failed '${src}'`);
    return context.undefined;
  });

  register("unlink", (pathH) => {
    const path = context.getString(pathH);
    const permErr = checkWritePermission(path);
    if (permErr) throw new Error(permErr);
    if (!vfs.unlink(path)) throw new Error(`ENOENT: no such file, unlink '${path}'`);
    return context.undefined;
  });

  register("rmdir", (pathH) => {
    const path = context.getString(pathH);
    const permErr = checkWritePermission(path);
    if (permErr) throw new Error(permErr);
    if (!vfs.rmdir(path)) throw new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`);
    return context.undefined;
  });

  register("rename", (oldH, newH) => {
    const oldPath = context.getString(oldH);
    const newPath = context.getString(newH);
    const permErr = checkWritePermission(newPath);
    if (permErr) throw new Error(permErr);
    if (!vfs.rename(oldPath, newPath)) throw new Error(`ENOENT: rename failed '${oldPath}' -> '${newPath}'`);
    return context.undefined;
  });

  register("rm", (pathH, optionsH?) => {
    const path = context.getString(pathH);
    const permErr = checkWritePermission(path);
    if (permErr) throw new Error(permErr);
    let options: { recursive?: boolean; force?: boolean } | undefined;
    if (optionsH && context.typeof(optionsH) === "object") {
      options = context.dump(optionsH) as { recursive?: boolean; force?: boolean };
    }
    const success = vfs.rm(path, options);
    if (!success && !options?.force) throw new Error(`ENOENT: rm failed '${path}'`);
    return context.undefined;
  });

  context.setProp(fsObj, "promises", promisesObj);
  context.setProp(context.global, "fs", fsObj);
  context.setProp(context.global, "globalThis", context.global);
  context.setProp(context.global, "global", context.global);
}

function setupMCPCall(
  context: QuickJSAsyncContext,
  scope: Scope,
  options: ExecuteCodeOptions,
  mcpCallLogs: MCPCallLog[],
  pendingCalls: Promise<void>[],
): void {
  const mcpCallFn = scope.manage(
    context.newFunction("__mcpCall", (serverNameHandle, toolNameHandle, argsJsonHandle) => {
      const serverName = context.getString(serverNameHandle);
      const toolName = context.getString(toolNameHandle);
      const argsJson = context.getString(argsJsonHandle);

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsJson) as Record<string, unknown>;
      } catch (error) {
        logger.warn({ serverName, toolName, argsJson, error }, "__mcpCall: failed to parse args JSON");
      }

      const server = options.mcpServers.find((s) => s.name === serverName);
      if (!server) {
        const errorDeferred = context.newPromise();
        const errorHandle = context.newError(`MCP server not found: ${serverName}`);
        errorDeferred.reject(errorHandle);
        errorHandle.dispose();
        const handle = errorDeferred.handle;
        errorDeferred.dispose();
        return handle;
      }

      const deferred = context.newPromise();
      const promiseHandle = deferred.handle;

      const callStart = Date.now();

      const callPromise = (async () => {
        let result: string;

        try {
          const mcpManager = MCPManager.getInstance();
          result = await mcpManager.callTool(
            server.name,
            server.url,
            server.headers,
            toolName,
            args,
            options.chatSessionId,
            server.stateful,
            server.toolCallTimeoutSec,
            options.signal,
          );
        } catch (err) {
          const callError = err instanceof Error ? err.message : String(err);
          mcpCallLogs.push({
            serverName,
            toolName,
            args,
            result: null,
            error: callError,
            durationMs: Date.now() - callStart,
          });

          const errorHandle = context.newError(callError);
          deferred.reject(errorHandle);
          errorHandle.dispose();
          deferred.dispose();
          return;
        }

        mcpCallLogs.push({ serverName, toolName, args, result, error: null, durationMs: Date.now() - callStart });

        const resultHandle = context.newString(result);
        deferred.resolve(resultHandle);
        resultHandle.dispose();
        deferred.dispose();
      })();
      pendingCalls.push(callPromise);

      return promiseHandle;
    }),
  );
  context.setProp(context.global, "__mcpCall", mcpCallFn);
}

function marshallToQuickJS(context: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === null) return context.null;
  if (value === undefined) return context.undefined;
  if (typeof value === "boolean") return value ? context.true : context.false;
  if (typeof value === "number") return context.newNumber(value);
  if (typeof value === "string") return context.newString(value);

  if (Array.isArray(value)) {
    const arr = context.newArray();
    value.forEach((item, i) => {
      Scope.withScope((s) => {
        context.setProp(arr, i, s.manage(marshallToQuickJS(context, item)));
      });
    });
    return arr;
  }

  if (typeof value === "object" && "isFile" in value && typeof (value as { isFile: unknown }).isFile === "function") {
    const stats = value as { size: number; mode: number; isFile: () => boolean; isDirectory: () => boolean };
    const obj = context.newObject();
    context.setProp(obj, "size", context.newNumber(stats.size));
    context.setProp(obj, "mode", context.newNumber(stats.mode));
    const isFileVal = stats.isFile();
    const isDirVal = stats.isDirectory();
    const isFileFn = context.newFunction("isFile", () => (isFileVal ? context.true : context.false));
    const isDirFn = context.newFunction("isDirectory", () => (isDirVal ? context.true : context.false));
    context.setProp(obj, "isFile", isFileFn);
    context.setProp(obj, "isDirectory", isDirFn);
    isFileFn.dispose();
    isDirFn.dispose();
    return obj;
  }

  if (typeof value === "object") {
    const obj = context.newObject();
    for (const [key, val] of Object.entries(value)) {
      Scope.withScope((s) => {
        context.setProp(obj, key, s.manage(marshallToQuickJS(context, val)));
      });
    }
    return obj;
  }

  return context.undefined;
}

function marshallFromQuickJS(context: QuickJSContext, handle: QuickJSHandle): unknown {
  const type = context.typeof(handle);

  if (type === "undefined") return undefined;
  if (type === "string") return context.getString(handle);
  if (type === "number") return context.getNumber(handle);

  return context.dump(handle);
}
