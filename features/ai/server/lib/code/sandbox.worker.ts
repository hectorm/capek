import { setTimeout } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";

import type { QuickJSAsyncContext, QuickJSAsyncRuntime, QuickJSContext, QuickJSHandle } from "quickjs-emscripten-core";
import { newQuickJSAsyncWASMModuleFromVariant, Scope } from "quickjs-emscripten-core";

import type { ConsoleLog, SandboxHostFunction, SandboxInput, SandboxMessage, SandboxReply } from "./protocol.ts";
import { formatConsoleLog } from "./protocol.ts";
import { VirtualFileSystem, WORKSPACE_DIR } from "./vfs.ts";

const WASM_PAGE_BYTES = 65_536;
const JOB_POLL_INTERVAL_MS = 10;

const MAX_CONCURRENT_HOST_CALLS = 8;
const MAX_HOST_CALL_ARGS = 3;
const MAX_TRACKED_FS_CALLS = 1_000;
const MAX_CONSOLE_CHARS = 1_000_000;

if (!parentPort) {
  throw new Error("The sandbox of the code interpreter has to run in a worker thread");
}

const port = parentPort;
const input = workerData as SandboxInput;

// eslint-disable-next-line @typescript-eslint/unbound-method
const growMemory = WebAssembly.Memory.prototype.grow;
WebAssembly.Memory.prototype.grow = function (this: WebAssembly.Memory, delta: number): number {
  if (this.buffer.byteLength + delta * WASM_PAGE_BYTES > input.maxMemoryBytes) {
    throw new RangeError("Out of memory");
  }
  return growMemory.call(this, delta);
};

const send = (message: SandboxMessage): void => {
  port.postMessage(message);
};

const hostCalls = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>();

port.on("message", (reply: SandboxReply) => {
  const call = hostCalls.get(reply.id);
  if (!call) {
    return;
  }

  hostCalls.delete(reply.id);
  if ("error" in reply) {
    call.reject(new Error(reply.error));
  } else {
    call.resolve(reply.value);
  }
});

let nextCallId = 0;

let activeHostCalls = 0;
let pendingHostCallChars = 0;
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
      // The next queued call inherits this slot
      next();
    } else {
      activeHostCalls--;
    }
  }
};

const vfs = VirtualFileSystem.fromJSON(input.files, { maxWorkspaceBytes: input.maxWorkspaceBytes });
const consoleLogs: ConsoleLog[] = [];
let consoleChars = 0;

const execute = async (): Promise<unknown> => {
  const deadline = Date.now() + input.maxExecutionMs;

  return Scope.withScopeAsync(async (scope) => {
    const variant = await import("@jitl/quickjs-wasmfile-release-asyncify");
    const quickJS = await newQuickJSAsyncWASMModuleFromVariant(variant.default);
    const runtime = scope.manage(quickJS.newRuntime());

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

      await setTimeout(JOB_POLL_INTERVAL_MS);
    }
    throw new Error("Execution timeout");
  });
};

const extractError = (context: QuickJSContext, handle: QuickJSHandle): string => {
  const errorObject = context.dump(handle) as Record<string, unknown> | string | null;
  if (typeof errorObject === "object" && errorObject && "message" in errorObject) {
    return String(errorObject.message);
  }
  return typeof errorObject === "string" ? errorObject : "Unknown error";
};

const setupModuleLoader = (runtime: QuickJSAsyncRuntime): void => {
  runtime.setModuleLoader(
    (modulePath: string) => {
      const content = vfs.readFile(modulePath);
      if (content === null) {
        throw new Error(`Module not found: ${modulePath}`);
      }
      return content;
    },
    (baseModulePath: string, requestedName: string) => {
      return vfs.normalizePath(requestedName.startsWith("/") ? requestedName : `${baseModulePath}/../${requestedName}`);
    },
  );
};

const setupConsoleAPI = (context: QuickJSAsyncContext, scope: Scope): void => {
  const consoleObject = scope.manage(context.newObject());
  const levels = ["log", "warn", "error", "debug", "info"] as const;

  for (const level of levels) {
    const fn = scope.manage(
      context.newFunction(level, (...handles: QuickJSHandle[]) => {
        if (consoleChars >= MAX_CONSOLE_CHARS) {
          return;
        }

        const log: ConsoleLog = { level, args: [], timestamp: Date.now() };
        consoleChars += formatConsoleLog(log).length;
        for (const handle of handles) {
          if (consoleChars >= MAX_CONSOLE_CHARS) {
            break;
          }
          const arg = marshallFromQuickJS(context, handle);
          consoleChars += formatConsoleLog({ level, args: [arg] }).length;
          log.args.push(arg);
        }
        consoleLogs.push(log);
      }),
    );
    context.setProp(consoleObject, level, fn);
  }
  context.setProp(context.global, "console", consoleObject);
};

const setupFsAPI = (context: QuickJSAsyncContext, scope: Scope, pendingCalls: Promise<void>[]): void => {
  const fsObject = scope.manage(context.newObject());
  const promisesObject = scope.manage(context.newObject());

  const checkWritePermission = (path: string): string | null => {
    const normalized = vfs.normalizePath(path);
    if (!normalized.startsWith(`${WORKSPACE_DIR}/`) && normalized !== WORKSPACE_DIR) {
      return `EACCES: permission denied (only ${WORKSPACE_DIR}/ is writable)`;
    }
    return null;
  };

  const register = (name: string, fn: (...args: QuickJSHandle[]) => QuickJSHandle): void => {
    const syncFn = scope.manage(context.newFunction(`${name}Sync`, fn));
    context.setProp(fsObject, `${name}Sync`, syncFn);

    const asyncFn = scope.manage(
      context.newFunction(name, (...args: QuickJSHandle[]) => {
        const promise = context.newPromise();
        try {
          const result = fn(...args);
          promise.resolve(result);
          if (result !== context.undefined && result !== context.true && result !== context.false) {
            result.dispose();
          }
        } catch (error) {
          const errorHandle = context.newError(error instanceof Error ? error.message : String(error));
          promise.reject(errorHandle);
          errorHandle.dispose();
        }
        if (pendingCalls.length < MAX_TRACKED_FS_CALLS) {
          pendingCalls.push(promise.settled.then(() => void context.runtime.executePendingJobs()));
        }
        return promise.handle;
      }),
    );
    context.setProp(promisesObject, name, asyncFn);
  };

  register("exists", (pathHandle) => {
    const path = context.getString(pathHandle);
    return marshallToQuickJS(context, vfs.exists(path));
  });

  register("stat", (pathHandle) => {
    const path = context.getString(pathHandle);
    const stats = vfs.stat(path);
    if (!stats) {
      throw new Error(`ENOENT: no such file, stat '${path}'`);
    }
    return marshallToQuickJS(context, stats);
  });

  register("readFile", (pathHandle) => {
    const path = context.getString(pathHandle);
    const content = vfs.readFile(path);
    if (content === null) {
      throw new Error(`ENOENT: no such file, open '${path}'`);
    }
    return marshallToQuickJS(context, content);
  });

  register("readdir", (pathHandle) => {
    const path = context.getString(pathHandle);
    const entries = vfs.readdir(path);
    if (entries === null) {
      throw new Error(`ENOENT: no such directory, scandir '${path}'`);
    }
    return marshallToQuickJS(context, entries);
  });

  register("glob", (patternHandle) => {
    const pattern = context.getString(patternHandle);
    return marshallToQuickJS(context, vfs.glob(pattern));
  });

  register("mkdir", (pathHandle) => {
    const path = context.getString(pathHandle);
    const permissionError = checkWritePermission(path);
    if (permissionError) {
      throw new Error(permissionError);
    }
    if (!vfs.mkdir(path)) {
      throw new Error(`EEXIST: already exists, mkdir '${path}'`);
    }
    return context.undefined;
  });

  register("writeFile", (pathHandle, dataHandle) => {
    const path = context.getString(pathHandle);
    const permissionError = checkWritePermission(path);
    if (permissionError) {
      throw new Error(permissionError);
    }
    if (!vfs.writeFile(path, context.getString(dataHandle))) {
      throw new Error(`EISDIR: is a directory, open '${path}'`);
    }
    return context.undefined;
  });

  register("appendFile", (pathHandle, dataHandle) => {
    const path = context.getString(pathHandle);
    const permissionError = checkWritePermission(path);
    if (permissionError) {
      throw new Error(permissionError);
    }
    if (!vfs.appendFile(path, context.getString(dataHandle))) {
      throw new Error(`EISDIR: is a directory, open '${path}'`);
    }
    return context.undefined;
  });

  register("copyFile", (sourceHandle, destinationHandle) => {
    const source = context.getString(sourceHandle);
    const destination = context.getString(destinationHandle);
    const permissionError = checkWritePermission(destination);
    if (permissionError) {
      throw new Error(permissionError);
    }
    if (!vfs.copyFile(source, destination)) {
      throw new Error(`ENOENT: copyFile failed '${source}'`);
    }
    return context.undefined;
  });

  register("unlink", (pathHandle) => {
    const path = context.getString(pathHandle);
    const permissionError = checkWritePermission(path);
    if (permissionError) {
      throw new Error(permissionError);
    }
    if (!vfs.unlink(path)) {
      throw new Error(`ENOENT: no such file, unlink '${path}'`);
    }
    return context.undefined;
  });

  register("rmdir", (pathHandle) => {
    const path = context.getString(pathHandle);
    const permissionError = checkWritePermission(path);
    if (permissionError) {
      throw new Error(permissionError);
    }
    if (!vfs.rmdir(path)) {
      throw new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`);
    }
    return context.undefined;
  });

  register("rename", (oldPathHandle, newPathHandle) => {
    const oldPath = context.getString(oldPathHandle);
    const newPath = context.getString(newPathHandle);
    const oldPathError = checkWritePermission(oldPath);
    if (oldPathError) {
      throw new Error(oldPathError);
    }
    const newPathError = checkWritePermission(newPath);
    if (newPathError) {
      throw new Error(newPathError);
    }
    if (!vfs.rename(oldPath, newPath)) {
      throw new Error(`ENOENT: rename failed '${oldPath}' -> '${newPath}'`);
    }
    return context.undefined;
  });

  register("rm", (pathHandle, optionsHandle?) => {
    const path = context.getString(pathHandle);
    const permissionError = checkWritePermission(path);
    if (permissionError) {
      throw new Error(permissionError);
    }
    let options: { recursive?: boolean; force?: boolean } | undefined;
    if (optionsHandle && context.typeof(optionsHandle) === "object") {
      options = context.dump(optionsHandle) as { recursive?: boolean; force?: boolean };
    }
    const success = vfs.rm(path, options);
    if (!success && !options?.force) {
      throw new Error(`ENOENT: rm failed '${path}'`);
    }
    return context.undefined;
  });

  context.setProp(fsObject, "promises", promisesObject);
  context.setProp(context.global, "fs", fsObject);
  context.setProp(context.global, "globalThis", context.global);
  context.setProp(context.global, "global", context.global);
};

const setupHostCall = (
  context: QuickJSAsyncContext,
  scope: Scope,
  name: string,
  hostFunction: SandboxHostFunction,
  pendingCalls: Promise<void>[],
): void => {
  const hostFn = scope.manage(
    context.newFunction(name, (...handles) => {
      if (pendingHostCallChars > input.maxMemoryBytes) {
        throw new Error("Too many calls are waiting for an answer");
      }
      const args = handles.slice(0, MAX_HOST_CALL_ARGS).map((handle) => context.getString(handle));
      const chars = args.reduce((total, arg) => total + arg.length, 0);
      pendingHostCallChars += chars;

      const deferred = context.newPromise();
      const promiseHandle = deferred.handle;

      const callPromise = (async () => {
        try {
          const resultHandle = context.newString(await callHost(hostFunction, args));
          deferred.resolve(resultHandle);
          resultHandle.dispose();
        } catch (error) {
          const errorHandle = context.newError(error instanceof Error ? error.message : String(error));
          deferred.reject(errorHandle);
          errorHandle.dispose();
        } finally {
          pendingHostCallChars -= chars;
          deferred.dispose();
        }
      })();
      pendingCalls.push(callPromise);

      return promiseHandle;
    }),
  );
  context.setProp(context.global, name, hostFn);
};

const marshallToQuickJS = (context: QuickJSContext, value: unknown): QuickJSHandle => {
  if (value === null) {
    return context.null;
  }
  if (value === undefined) {
    return context.undefined;
  }
  if (typeof value === "boolean") {
    return value ? context.true : context.false;
  }
  if (typeof value === "number") {
    return context.newNumber(value);
  }
  if (typeof value === "string") {
    return context.newString(value);
  }

  if (Array.isArray(value)) {
    const array = context.newArray();
    value.forEach((item, index) => {
      Scope.withScope((itemScope) => {
        context.setProp(array, index, itemScope.manage(marshallToQuickJS(context, item)));
      });
    });
    return array;
  }

  if (typeof value === "object" && "isFile" in value && typeof value.isFile === "function") {
    const stats = value as { size: number; mode: number; isFile: () => boolean; isDirectory: () => boolean };
    const object = context.newObject();
    context.setProp(object, "size", context.newNumber(stats.size));
    context.setProp(object, "mode", context.newNumber(stats.mode));
    const isFile = stats.isFile();
    const isDirectory = stats.isDirectory();
    const isFileHandle = context.newFunction("isFile", () => (isFile ? context.true : context.false));
    const isDirectoryHandle = context.newFunction("isDirectory", () => (isDirectory ? context.true : context.false));
    context.setProp(object, "isFile", isFileHandle);
    context.setProp(object, "isDirectory", isDirectoryHandle);
    isFileHandle.dispose();
    isDirectoryHandle.dispose();
    return object;
  }

  if (typeof value === "object") {
    const object = context.newObject();
    for (const [key, property] of Object.entries(value)) {
      Scope.withScope((propertyScope) => {
        context.setProp(object, key, propertyScope.manage(marshallToQuickJS(context, property)));
      });
    }
    return object;
  }

  return context.undefined;
};

const marshallFromQuickJS = (context: QuickJSContext, handle: QuickJSHandle): unknown => {
  const type = context.typeof(handle);

  if (type === "undefined") {
    return undefined;
  }
  if (type === "string") {
    return context.getString(handle);
  }
  if (type === "number") {
    return context.getNumber(handle);
  }
  if (type === "bigint") {
    return context.getBigInt(handle).toString();
  }

  return context.dump(handle);
};

const main = async (): Promise<void> => {
  let result: unknown = null;
  let errorMessage: string | null = null;
  try {
    result = await execute();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const workspace = vfs.getWorkspaceFiles();
  try {
    send({ type: "done", result, error: errorMessage, consoleLogs, workspace });
  } catch (error) {
    send({
      type: "done",
      result: null,
      error: errorMessage ?? `The result cannot be returned: ${error instanceof Error ? error.message : String(error)}`,
      consoleLogs: [],
      workspace,
    });
  }
};

void main();
