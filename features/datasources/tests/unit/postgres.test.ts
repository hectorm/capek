import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresDriver } from "#layers/datasources/server/lib/drivers/postgres";
import { PostgresDatasourceType } from "#layers/datasources/shared/definitions/postgres";

let pglite: PGlite;
let server: PGLiteSocketServer;
let connectionString: string;

const driver = new PostgresDriver();
const settings = { maxRows: 2, statementTimeoutMs: 5_000, requestTimeoutMs: 5_000 };

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

describe("postgres datasource", () => {
  const config = (): Record<string, unknown> => ({
    connectionString,
    authType: "basic",
    username: "postgres",
    password: "postgres",
  });

  it("hides the password of the stored configuration", () => {
    const redacted = PostgresDatasourceType.redact(config());
    expect(redacted.password).not.toBe("postgres");
    expect(PostgresDatasourceType.unredact(redacted, config()).password).toBe("postgres");
  });

  it("runs queries limited to the maximum number of rows", async () => {
    const rows = await driver.execute({ config: config() }, "SELECT id, total FROM orders ORDER BY id;", settings);
    expect(rows).toEqual([
      { id: 1, total: 10 },
      { id: 2, total: 20 },
    ]);
  });

  it("only takes the hidden password from the stored configuration while it connects to the same place", () => {
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

  it("does not let queries change the data", async () => {
    const run = (sql: string): Promise<unknown[]> => driver.execute({ config: config() }, sql, settings);

    await expect(run("DELETE FROM orders")).rejects.toThrow(/read-only transaction/);
    await expect(run("COMMIT; DELETE FROM orders")).rejects.toThrow(/multiple commands/);
    await expect(run("SET default_transaction_read_only = off; COMMIT; DELETE FROM orders")).rejects.toThrow(
      /multiple commands/,
    );

    expect(await run("SELECT count(*)::INT AS count FROM orders")).toEqual([{ count: 3 }]);
  });
});
