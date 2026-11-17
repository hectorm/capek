import { lookup } from "node:dns";
import { Readable } from "node:stream";
import type { LookupFunction } from "node:net";
import type { Duplex } from "node:stream";

import * as mariadb from "mariadb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MariaDBDriver } from "#layers/datasources/server/lib/drivers/mariadb";

vi.mock("node:dns", () => ({ lookup: vi.fn() }));
vi.mock("mariadb", { spy: true });

const resolveDns = vi.mocked(lookup as LookupFunction);

afterEach(() => {
  vi.mocked(mariadb.createConnection).mockReset();
  resolveDns.mockReset();
});

describe("MariaDB driver", () => {
  it("rejects connection options that would read files or allow writes", async () => {
    const run = (options: string) => {
      const config = { connectionString: `mariadb://db.example.com/sales?${options}`, authType: "none" };
      return new MariaDBDriver().execute({ config }, "SELECT 1", {});
    };

    await expect(run("permitLocalInfile=true")).rejects.toThrow('The option "permitLocalInfile"');
    await expect(run("ssl=true&multipleStatements=true")).rejects.toThrow('The option "multipleStatements"');
  });

  it("does not connect to a private host that is not allowed", async () => {
    resolveDns.mockImplementation((_hostname, _options, callback) => {
      callback(null, [{ address: "10.91.146.119", family: 4 }]);
    });
    const config = { connectionString: "mariadb://db.internal/sales", authType: "none" };
    await expect(new MariaDBDriver().execute({ config }, "SELECT 1", {})).rejects.toThrow("private IP address");
  });

  it("keeps the charset and collation of the connection string", async () => {
    vi.mocked(mariadb.createConnection).mockRejectedValue(new Error("offline"));
    for (const { options, collation } of [
      { options: "charset=latin1", collation: "LATIN1_SWEDISH_CI" },
      { options: "collation=utf8mb4_bin", collation: "UTF8MB4_BIN" },
    ]) {
      const config = { connectionString: `mariadb://db.example.com/sales?${options}`, authType: "none" };
      await expect(new MariaDBDriver().execute({ config }, "SELECT 1", {})).rejects.toThrow("offline");
      expect(vi.mocked(mariadb.createConnection).mock.lastCall?.[0]).toMatchObject({ collation });
    }
  });

  it("fails with the reason of its signal", async () => {
    const signal = AbortSignal.abort();
    const config = {
      connectionString: "mariadb://db.example.com/sales",
      authType: "basic",
      username: "analyst",
      password: "secret",
    };
    await expect(new MariaDBDriver().execute({ config }, "SELECT 1", { signal })).rejects.toBe(signal.reason);
  });

  it("does not let destroy open its connection to kill a query, which does not verify certificates", async () => {
    vi.mocked(mariadb.createConnection).mockRejectedValue(new Error("offline"));
    resolveDns.mockImplementation(() => undefined);
    const config = { connectionString: "mariadb://db.example.com/sales", authType: "none" };
    await expect(new MariaDBDriver().execute({ config }, "SELECT 1", {})).rejects.toThrow("offline");

    const { stream } = vi.mocked(mariadb.createConnection).mock.lastCall?.[0] as mariadb.ConnectionConfig;
    const opened: { error?: Error; socket?: Duplex }[] = [];
    for (let i = 0; i < 2; i++) {
      stream?.((error, socket) => opened.push({ error, socket }));
    }
    expect(opened[0]?.socket).toBeDefined();
    expect(opened[1]?.error?.message).toContain("killed through another connection");
    opened[0]?.socket?.destroy();
  });

  it("kills a query that it stops through a connection like its own", async () => {
    const rows = [[1], [2]];
    const stream = new Readable({
      objectMode: true,
      read() {
        if (rows.length === 2) {
          this.emit("fields", [{ name: () => "id" }]);
        }
        this.push(rows.shift() ?? null);
      },
    });
    const connection = {
      threadId: 52_917,
      serverVersion: () => "11.8.2-MariaDB",
      query: vi.fn(() => Promise.resolve([])),
      queryStream: () => stream,
      destroy: vi.fn(),
      end: vi.fn(() => Promise.resolve()),
    };
    const killer = { query: vi.fn(() => Promise.resolve([])), end: vi.fn(() => Promise.resolve()) };
    vi.mocked(mariadb.createConnection)
      .mockResolvedValueOnce(connection as unknown as mariadb.Connection)
      .mockResolvedValueOnce(killer as unknown as mariadb.Connection);

    const config = { connectionString: "mariadb://db.example.com/sales?ssl=true", authType: "none" };
    await expect(new MariaDBDriver().execute({ config }, "SELECT id FROM sales", { maxRows: 1 })).resolves.toEqual([
      { id: 1 },
    ]);
    await vi.waitFor(() => {
      expect(killer.end).toHaveBeenCalled();
    });
    expect(connection.destroy).toHaveBeenCalled();
    expect(killer.query).toHaveBeenCalledWith("KILL 52917");
    const [first, second] = vi
      .mocked(mariadb.createConnection)
      .mock.calls.map(([options]) => options as mariadb.ConnectionConfig);
    expect(second).toMatchObject({ host: "db.example.com", ssl: true, permitRedirect: false });
    expect(second?.stream).not.toBe(first?.stream);
  });
});
