import type { VFSSnapshot } from "./vfs.ts";

export interface ConsoleLog {
  level: "log" | "warn" | "error" | "debug" | "info";
  args: unknown[];
  timestamp: number;
}

export type SandboxHostFunction = "mcp" | "tool";

export interface SandboxInput {
  code: string;
  files: VFSSnapshot;
  maxExecutionMs: number;
  maxMemoryBytes: number;
  maxWorkspaceBytes?: number;
}

export type SandboxMessage =
  | { type: "call"; id: number; name: SandboxHostFunction; args: string[] }
  | { type: "done"; result: unknown; error: string | null; consoleLogs: ConsoleLog[]; workspace: VFSSnapshot };

export type SandboxReply = { id: number; value: string } | { id: number; error: string };
