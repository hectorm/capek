import cluster from "node:cluster";
import process from "node:process";
import { setImmediate } from "node:timers/promises";
import type { Worker } from "node:cluster";

import type { Mock } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HANDOVER_MESSAGE, setupDbHandover, useDb } from "#layers/core/server/lib/database";
import { useLogger } from "#layers/core/server/lib/logger";
import { closeDb } from "#layers/core/tests/unit/helpers/db";

vi.mock("@electric-sql/pglite", { spy: true });

// The lifecycle tests exercise the embedded driver
await vi.hoisted(async () => {
  const { runtimeConfig } = await import("#layers/core/tests/unit/helpers/nitro-config");
  runtimeConfig.databaseUrl = "memory://";
});

const { isWorker } = cluster;

const createWorker = (): { worker: Worker; send: Mock } => {
  const send = vi.fn();
  return { worker: { isConnected: () => true, send } as unknown as Worker, send };
};

afterEach(async () => {
  Object.assign(cluster, { isWorker });
  cluster.removeAllListeners("message");
  vi.restoreAllMocks();
  await closeDb();
  vi.mocked(PGlite).mockClear();
});

describe("database", () => {
  it("traces the statement without its bound values", async () => {
    const trace = vi.spyOn(useLogger(), "trace");
    const db = await useDb();
    trace.mockClear();
    await sql`SELECT ${"private file bytes"}::text`.execute(db);
    expect(trace).toHaveBeenCalledWith(expect.objectContaining({ sql: "SELECT $1::text" }), "Database query");
    expect(JSON.stringify(trace.mock.calls)).not.toContain("private file bytes");
  });

  it("is set up once for concurrent calls", async () => {
    await Promise.all([useDb(), useDb()]);
    expect(PGlite).toHaveBeenCalledTimes(1);
  });

  it("is opened by a cluster worker after the handover of the primary process", async () => {
    Object.assign(cluster, { isWorker: true });
    const send = vi.spyOn(process, "send").mockReturnValue(true);

    const db = useDb();
    expect(send).toHaveBeenCalledWith(HANDOVER_MESSAGE);
    await setImmediate();
    expect(PGlite).not.toHaveBeenCalled();

    process.emit("message", HANDOVER_MESSAGE, undefined);
    await db;
    expect(PGlite).toHaveBeenCalledTimes(1);
  });

  it("is closed once by the primary process when it is ready and then handed over to every worker", async () => {
    const destroy = vi.spyOn(await useDb(), "destroy");
    const ready = Promise.withResolvers<undefined>();
    setupDbHandover(ready.promise);
    const first = createWorker();
    const second = createWorker();

    cluster.emit("message", first.worker, HANDOVER_MESSAGE);
    await setImmediate();
    expect(destroy).not.toHaveBeenCalled();
    expect(first.send).not.toHaveBeenCalled();

    ready.resolve(undefined);
    cluster.emit("message", second.worker, HANDOVER_MESSAGE);
    await vi.waitFor(() => {
      expect(first.send).toHaveBeenCalledWith(HANDOVER_MESSAGE);
      expect(second.send).toHaveBeenCalledWith(HANDOVER_MESSAGE);
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
