import { once } from "node:events";

import { describe, expect, it } from "vitest";

import type { ServerDatasourceType } from "#layers/datasources/server/lib/drivers";
import { executeQuery } from "#layers/datasources/server/lib/query";
import { PostgresDatasourceType } from "#layers/datasources/shared/definitions/postgres";

// A datasource whose server never answers
const unresponsiveType: ServerDatasourceType = {
  definition: PostgresDatasourceType,
  driver: {
    validationQuery: "SELECT 1",
    execute: async (_params, _sql, { signal }) => {
      if (signal) {
        await once(signal, "abort");
      }
      throw signal?.reason as Error;
    },
  },
};

describe("executeQuery", () => {
  it("gives up once the time to connect and run the statement is over", async () => {
    const query = executeQuery(unresponsiveType, { config: {} }, "SELECT 1", {
      statementTimeoutMs: 50,
      requestTimeoutMs: 50,
    });
    await expect(query).rejects.toThrow("The query took longer than the time it is allowed to run");
  });

  it("stops when its signal aborts", async () => {
    const controller = new AbortController();
    const stopped = new Error("stopped");
    const query = executeQuery(unresponsiveType, { config: {} }, "SELECT 1", {
      statementTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort(stopped);
    await expect(query).rejects.toBe(stopped);
  });
});
