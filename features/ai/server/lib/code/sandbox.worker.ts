import { setTimeout as sleep } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";

import type { QuickJSAsyncContext, QuickJSAsyncRuntime, QuickJSContext, QuickJSHandle } from "quickjs-emscripten-core";
import { newQuickJSAsyncWASMModuleFromVariant, Scope } from "quickjs-emscripten-core";

import type { ConsoleLog, SandboxHostFunction, SandboxInput, SandboxMessage, SandboxReply } from "./protocol.ts";
import { VirtualFileSystem, WORKSPACE_DIR } from "./vfs.ts";

if (!parentPort) {
  throw new Error("The sandbox of the code interpreter has to run in a worker thread");
}

const port = parentPort;
const input = workerData as SandboxInput;

const send = (message: SandboxMessage): void => {
  port.postMessage(message);
};

const hostCalls = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>();

port.on("message", (reply: SandboxReply) => {
  const call = hostCalls.get(reply.id);
  if (!call) return;

  hostCalls.delete(reply.id);
  if ("error" in reply) {
    call.reject(new Error(reply.error));
  } else {
    call.resolve(reply.value);
  }
});

let nextCallId = 0;

const MAX_CONCURRENT_HOST_CALLS = 8;

let activeHostCalls = 0;
const queuedHostCalls: (() => void)[] = [];

const callHost = async (name: SandboxHostFunction, args: string[]): Promise<string> => {
  if (activeHostCalls < MAX_CONCURRENT_HOST_CALLS) {
    activeHostCalls++;
  } else {
    await new Promise<void>((resolve) => queuedHostCalls.push(resolve));
  }

  try {
    return await new Promise((resolve, reject) => {
      const id = nextCallId++;
      hostCalls.set(id, { resolve, reject });
      send({ type: "call", id, name, args });
    });
  } finally {
    const next = queuedHostCalls.shift();
    if (next) {
      next();
    } else {
      activeHostCalls--;
    }
  }
};

const vfs = VirtualFileSystem.fromJSON(input.files, { maxWorkspaceBytes: input.maxWorkspaceBytes });
const consoleLogs: ConsoleLog[] = [];

const execute = async (): Promise<unknown> => {
  const deadline = Date.now() + input.maxExecutionMs;

  return Scope.withScopeAsync(async (scope) => {
    const variant = await import("@jitl/quickjs-wasmfile-release-asyncify");
    const quickJS = await newQuickJSAsyncWASMModuleFromVariant(variant.default);
    const runtime = scope.manage(quickJS.newRuntime());

    runtime.setMemoryLimit(input.maxMemoryBytes);
    runtime.setInterruptHandler(() => Date.now() > deadline);

    setupModuleLoader(runtime);

    const context = scope.manage(runtime.newContext());
    const pendingCalls: Promise<void>[] = [];

    setupConsoleAPI(context, scope);
    setupFsAPI(context, scope, pendingCalls);
    setupHostCall(context, scope, "__mcpCall", "mcp", pendingCalls);
    setupHostCall(context, scope, "__toolCall", "tool", pendingCalls);

    const wrappedCode = `(async () => {\n${input.code}\n})()`;
    const evalResult = await context.evalCodeAsync(wrappedCode);
    if (evalResult.error) {
      throw new Error(extractError(context, scope.manage(evalResult.error)));
    }

    const promiseHandle = scope.manage(evalResult.value);

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

      await sleep(10);
    }
    throw new Error("Execution timeout");
  });
};

function extractError(context: QuickJSContext, handle: QuickJSHandle): string {
  const errorObj = context.dump(handle) as Record<string, unknown> | string | null;
  if (typeof errorObj === "object" && errorObj && "message" in errorObj) {
    return String(errorObj.message);
  }
  return typeof errorObj === "string" ? errorObj : "Unknown error";
}

function setupModuleLoader(runtime: QuickJSAsyncRuntime): void {
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

function setupConsoleAPI(context: QuickJSAsyncContext, scope: Scope): void {
  const consoleObj = scope.manage(context.newObject());
  const levels = ["log", "warn", "error", "debug", "info"] as const;

  for (const level of levels) {
    const fn = scope.manage(
      context.newFunction(level, (...args: QuickJSHandle[]) => {
        if (consoleLogs.length < 10_000) {
          consoleLogs.push({
            level,
            args: args.map((arg) => marshallFromQuickJS(context, arg)),
            timestamp: Date.now(),
          });
        }
      }),
    );
    context.setProp(consoleObj, level, fn);
  }
  context.setProp(context.global, "console", consoleObj);
}

function setupFsAPI(context: QuickJSAsyncContext, scope: Scope, pendingCalls: Promise<void>[]): void {
  const fsObj = scope.manage(context.newObject());
  const promisesObj = scope.manage(context.newObject());

  const checkWritePermission = (path: string): string | null => {
    const normalized = vfs.normalizePath(path);
    if (!normalized.startsWith(`${WORKSPACE_DIR}/`) && normalized !== WORKSPACE_DIR) {
      return `EACCES: permission denied (only ${WORKSPACE_DIR}/ is writable)`;
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
        if (pendingCalls.length < 1_000) {
          pendingCalls.push(promise.settled.then(() => void context.runtime.executePendingJobs()));
        }
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
    if (!vfs.writeFile(path, context.getString(dataH))) throw new Error(`EISDIR: is a directory, open '${path}'`);
    return context.undefined;
  });

  register("appendFile", (pathH, dataH) => {
    const path = context.getString(pathH);
    const permErr = checkWritePermission(path);
    if (permErr) throw new Error(permErr);
    if (!vfs.appendFile(path, context.getString(dataH))) throw new Error(`EISDIR: is a directory, open '${path}'`);
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
    const oldPermErr = checkWritePermission(oldPath);
    if (oldPermErr) throw new Error(oldPermErr);
    const newPermErr = checkWritePermission(newPath);
    if (newPermErr) throw new Error(newPermErr);
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

function setupHostCall(
  context: QuickJSAsyncContext,
  scope: Scope,
  name: string,
  hostFunction: SandboxHostFunction,
  pendingCalls: Promise<void>[],
): void {
  const hostFn = scope.manage(
    context.newFunction(name, (...handles) => {
      const args = handles.map((handle) => context.getString(handle));

      const deferred = context.newPromise();
      const promiseHandle = deferred.handle;

      const callPromise = (async () => {
        try {
          const resultHandle = context.newString(await callHost(hostFunction, args));
          deferred.resolve(resultHandle);
          resultHandle.dispose();
        } catch (err) {
          const errorHandle = context.newError(err instanceof Error ? err.message : String(err));
          deferred.reject(errorHandle);
          errorHandle.dispose();
        } finally {
          deferred.dispose();
        }
      })();
      pendingCalls.push(callPromise);

      return promiseHandle;
    }),
  );
  context.setProp(context.global, name, hostFn);
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

  if (typeof value === "object" && "isFile" in value && typeof value.isFile === "function") {
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

const main = async (): Promise<void> => {
  let result: unknown = null;
  let error: string | null = null;
  try {
    result = await execute();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const workspace = vfs.getWorkspaceFiles();
  try {
    send({ type: "done", result, error, consoleLogs, workspace });
  } catch (err) {
    send({
      type: "done",
      result: null,
      error: error ?? `The result cannot be returned: ${err instanceof Error ? err.message : String(err)}`,
      consoleLogs: [],
      workspace,
    });
  }
};

void main();
