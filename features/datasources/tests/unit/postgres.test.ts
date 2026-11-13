import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { DatasourceQuerySettings } from "#layers/datasources/server/lib/drivers";
import { HttpRedactedValue } from "#layers/core/shared/http";
import { PostgresDriver } from "#layers/datasources/server/lib/drivers/postgres";
import { PostgresDatasourceType } from "#layers/datasources/shared/definitions/postgres";

let pglite: PGlite;
let server: PGLiteSocketServer;
let connectionString: string;

const driver = new PostgresDriver();
const settings: DatasourceQuerySettings = { maxRows: 2, statementTimeoutMs: 5_000, requestTimeoutMs: 5_000 };

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(
    "CREATE TABLE orders (id INT PRIMARY KEY, total INT); INSERT INTO orders VALUES (1, 10), (2, 20), (3, 30);",
  );

  server = new PGLiteSocketServer({ db: pglite, host: "127.0.0.1", port: 0 });
  await server.start();
  connectionString = `postgres://${server.getServerConn()}/postgres`;
});

afterAll(async () => {
  await server.stop();
  await pglite.close();
});

describe("PostgreSQL datasource", () => {
  const config = (): Record<string, unknown> => ({
    connectionString,
    authType: "basic",
    username: "postgres",
    password: "postgres",
  });

  const run = (sql: string, querySettings = settings): Promise<unknown[]> => {
    return driver.execute({ config: config() }, sql, querySettings);
  };

  it("hides the stored password", () => {
    expect(PostgresDatasourceType.redact(config()).password).toBe(HttpRedactedValue);
  });

  it("only restores the hidden password for the same server", () => {
    const redacted = PostgresDatasourceType.redact(config());
    const moved = { ...redacted, connectionString: "postgres://attacker.example:5432/postgres" };
    expect(() => PostgresDatasourceType.unredact(moved, config())).toThrow(/have to be entered again/);
    expect(PostgresDatasourceType.unredact({ ...moved, password: "typed" }, config()).password).toBe("typed");
    expect(PostgresDatasourceType.unredact({ ...redacted, username: "other" }, config())).toMatchObject({
      username: "other",
      password: "postgres",
    });
    expect(PostgresDatasourceType.unredact(moved, {}).password).toBe("");
  });

  it("limits the rows of every query", async () => {
    expect(await run("SELECT id, total FROM orders ORDER BY id")).toEqual([
      { id: 1, total: 10 },
      { id: 2, total: 20 },
    ]);
    expect(await run("SELECT id FROM orders ORDER BY id LIMIT 3")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await run("SELECT id FROM orders ORDER BY id LIMIT 1 OFFSET 1")).toEqual([{ id: 2 }]);
    expect(await run("SELECT id FROM orders ORDER BY id OFFSET 1")).toEqual([{ id: 2 }, { id: 3 }]);
    expect(await run("SELECT id FROM orders ORDER BY id FETCH FIRST 3 ROWS ONLY")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await run("-- every order\nSELECT id FROM orders ORDER BY id -- by ID")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await run("SELECT g AS id FROM generate_series(1, 1000000) AS g LIMIT 1000000")).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(await run("SELECT id FROM orders ORDER BY id;;")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await run("SELECT id FROM orders ORDER BY id; -- every order")).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("rejects the results larger than the limit", async () => {
    await expect(run("SELECT repeat('x', 1000) AS text", { ...settings, maxBytes: 100 })).rejects.toThrow(
      "The result takes more than 100 bytes",
    );

    // The connection is cut, which the test server takes a moment to get over
    await vi.waitFor(() => run("SELECT 1"), { timeout: 5000 });
  });

  it("returns every column and the dates as text", async () => {
    const rows = await run("SELECT 1 AS id, 2 AS id, 3, DATE '2024-01-01' AS day, TIMESTAMP '2024-01-01 10:00' AS at");
    expect(rows).toEqual([{ id: 1, column2: 2, "?column?": 3, day: "2024-01-01", at: "2024-01-01 10:00:00" }]);
  });

  it("runs the statements that are not queries", async () => {
    expect(await run("SHOW transaction_read_only")).toEqual([{ transaction_read_only: "on" }]);
  });

  it("reports the errors of invalid queries", async () => {
    await expect(run("SELECT id FROM orders WHERE")).rejects.toThrow(/syntax error at end of input/);
    await expect(run("SELECT id FROM missing")).rejects.toThrow(/relation "missing" does not exist/);
  });

  it("rejects the queries that change the data", async () => {
    await expect(run("DELETE FROM orders")).rejects.toThrow(/read-only transaction/);
    await expect(run("COMMIT; DELETE FROM orders")).rejects.toThrow(/multiple commands/);
    await expect(run("SET default_transaction_read_only = off; COMMIT; DELETE FROM orders")).rejects.toThrow(
      /multiple commands/,
    );

    expect(await run("SELECT count(*)::INT AS count FROM orders")).toEqual([{ count: 3 }]);
  });
});
