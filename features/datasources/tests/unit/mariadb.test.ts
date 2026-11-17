import { lookup } from "node:dns";
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

  it("opens a new socket for each connection, like the one that kills a query", async () => {
    vi.mocked(mariadb.createConnection).mockRejectedValue(new Error("offline"));
    resolveDns.mockImplementation(() => undefined);
    const config = { connectionString: "mariadb://db.example.com/sales", authType: "none" };
    await expect(new MariaDBDriver().execute({ config }, "SELECT 1", {})).rejects.toThrow("offline");

    const { stream } = vi.mocked(mariadb.createConnection).mock.lastCall?.[0] as mariadb.ConnectionConfig;
    const sockets: Duplex[] = [];
    for (let i = 0; i < 2; i++) {
      stream?.((_error, socket) => {
        if (socket) {
          sockets.push(socket);
        }
      });
    }
    expect(sockets[0]).not.toBe(sockets[1]);
    sockets.forEach((socket) => socket.destroy());
  });
});
