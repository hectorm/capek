import { describe, expect, it } from "vitest";

import type { ExecuteCodeOptions } from "#layers/ai/server/lib/code/interpreter";
import { createVFS } from "#layers/ai/server/lib/code/generators";
import { executeCode } from "#layers/ai/server/lib/code/interpreter";
import { validateSkillSyntax } from "#layers/ai/server/lib/skills/validator";

const options = (overrides: Partial<ExecuteCodeOptions> = {}): ExecuteCodeOptions => ({
  chatSessionId: crypto.randomUUID(),
  vfs: createVFS([], []),
  mcpServers: [],
  maxExecutionMs: 10_000,
  maxMemoryBytes: 25 * 1024 * 1024,
  ...overrides,
});

const longestStall = async (callback: () => Promise<unknown>): Promise<number> => {
  let longest = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 10);
  try {
    await callback();
  } finally {
    clearInterval(timer);
  }
  return longest;
};

describe("code interpreter", () => {
  it("returns the result and the logs of the code", async () => {
    const execution = await executeCode(`console.log("sum", 1 + 2); return { sum: 1 + 2 };`, options());
    expect(execution.error).toBeNull();
    expect(execution.result).toEqual({ sum: 3 });
    expect(execution.consoleLogs).toMatchObject([{ level: "log", args: ["sum", 3] }]);
  });

  it("reports the errors of the code", async () => {
    const execution = await executeCode(`throw new Error("broken");`, options());
    expect(execution.error).toBe("broken");
    expect(execution.result).toBeNull();
  });

  it("stops code that never ends without holding up the server", async () => {
    let execution: Awaited<ReturnType<typeof executeCode>> | undefined;
    const stall = await longestStall(async () => {
      execution = await executeCode(`while (true) {}`, options({ maxExecutionMs: 500 }));
    });
    expect(execution?.error).toBeTruthy();
    expect(execution?.executionMs).toBeLessThan(4_000);
    expect(stall).toBeLessThan(250);
  });

  it("limits the memory that the code and its output take", async () => {
    const exhausted = await executeCode(
      `const chunks = []; try { for (;;) chunks.push(new Uint8Array(1_000_000)); } catch { return chunks.length; }`,
      options(),
    );
    expect(exhausted.result).toBeLessThan(25);

    const logged = await executeCode(`console.log(...Array(1000).fill("x".repeat(1_000_000)));`, options());
    expect(logged.consoleLogs[0]?.args).toHaveLength(1);
  });

  it("stops the code when it is aborted", async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 200);
    const execution = await executeCode(`while (true) {}`, options({ signal: controller.signal }));
    expect(execution.error).toBe("The operation was aborted");
    expect(execution.executionMs).toBeLessThan(2_000);
  });

  it("keeps the files that the code writes in its workspace", async () => {
    const vfs = createVFS([], []);
    const written = await executeCode(
      `fs.writeFileSync("/workspace/notes.txt", "hello"); fs.mkdirSync("/workspace/data"); return fs.readdirSync("/workspace");`,
      options({ vfs }),
    );
    expect(written.error).toBeNull();
    expect(written.result).toEqual(["notes.txt", "data/"]);
    expect(vfs.readFile("/workspace/notes.txt")).toBe("hello");

    const read = await executeCode(`return fs.readFileSync("/workspace/notes.txt");`, options({ vfs }));
    expect(read.result).toBe("hello");

    const removed = await executeCode(`fs.unlinkSync("/workspace/notes.txt");`, options({ vfs }));
    expect(removed.error).toBeNull();
    expect(vfs.exists("/workspace/notes.txt")).toBe(false);
  });

  it("only lets the code write in its workspace", async () => {
    const vfs = createVFS([], []);
    const execution = await executeCode(`fs.writeFileSync("/skills/index.js", "export {}");`, options({ vfs }));
    expect(execution.error).toContain("EACCES");
    expect(vfs.readFile("/skills/index.js")).toBe("\n");
  });

  it("has a workspace before anything is written to it", async () => {
    const execution = await executeCode(
      `return [fs.existsSync("/workspace"), fs.readdirSync("/workspace")];`,
      options({ vfs: createVFS([], []) }),
    );
    expect(execution.error).toBeNull();
    expect(execution.result).toEqual([true, []]);
  });

  it("limits the size of the workspace", async () => {
    const vfs = createVFS([], []);
    const limited = options({ vfs, maxWorkspaceBytes: 2_000 });

    const fits = await executeCode(`fs.writeFileSync("/workspace/a.txt", "x".repeat(600));`, limited);
    expect(fits.error).toBeNull();

    const exceeds = await executeCode(`fs.appendFileSync("/workspace/b.txt", "x".repeat(600));`, limited);
    expect(exceeds.error).toContain("ENOSPC");
    expect(vfs.exists("/workspace/b.txt")).toBe(false);

    // Space is given back by the files that are removed or shortened
    const replaced = await executeCode(
      `fs.writeFileSync("/workspace/a.txt", "x"); fs.writeFileSync("/workspace/b.txt", "x".repeat(900));`,
      limited,
    );
    expect(replaced.error).toBeNull();
    expect(vfs.readFile("/workspace/b.txt")).toHaveLength(900);

    // Files also take space for their names, even when they are empty
    const empty = await executeCode(`for (let i = 0; i < 10; i++) fs.writeFileSync("/workspace/" + i, "");`, limited);
    expect(empty.error).toContain("ENOSPC");

    // So do directories, and the workspace cannot be replaced with a file that is not counted
    const directories = await executeCode(`for (let i = 0; i < 10; i++) fs.mkdirSync("/workspace/" + i);`, limited);
    expect(directories.error).toContain("ENOSPC");
    const root = await executeCode(
      `fs.rmSync("/workspace", { recursive: true, force: true }); fs.writeFileSync("/workspace", "x".repeat(5_000));`,
      limited,
    );
    expect(root.error).toContain("EISDIR");
  });

  it("counts the size of the files in bytes", async () => {
    const vfs = createVFS([], []);
    const limited = options({ vfs, maxWorkspaceBytes: 2_000 });

    const written = await executeCode(
      `fs.writeFileSync("/workspace/a.txt", "é".repeat(600)); return fs.statSync("/workspace/a.txt").size;`,
      limited,
    );
    expect(written.result).toBe(1_200);

    const exceeds = await executeCode(`fs.writeFileSync("/workspace/b.txt", "é".repeat(600));`, limited);
    expect(exceeds.error).toContain("ENOSPC");
  });

  it("checks the syntax of a skill without running it", async () => {
    const stall = await longestStall(async () => {
      expect(await validateSkillSyntax(`while (true) {}\nexport default async function () {}`)).toEqual({
        valid: true,
      });
    });
    expect(stall).toBeLessThan(250);
    expect(await validateSkillSyntax(`export default async function ( {`)).toMatchObject({ valid: false });
  });
});
