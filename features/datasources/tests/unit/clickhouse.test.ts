import { lookup } from "node:dns";
import http from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { DatasourceQuerySettings } from "#layers/datasources/server/lib/drivers";
import { runtimeConfig } from "#layers/core/tests/unit/helpers/nitro-config";
import { ClickhouseDriver } from "#layers/datasources/server/lib/drivers/clickhouse";

vi.mock("node:dns", () => ({ lookup: vi.fn() }));

const resolveDns = vi.mocked(lookup as LookupFunction);

type Respond = (response: http.ServerResponse, query: string, url: URL) => void;

// Server that answers as ClickHouse or as another service
let server: http.Server;
let respond: Respond;
let connectionString: string;

const driver = new ClickhouseDriver();
const settings: DatasourceQuerySettings = { maxRows: 10, statementTimeoutMs: 5_000, requestTimeoutMs: 5_000 };

const clickhouseHeaders = (headers: http.OutgoingHttpHeaders = {}): http.OutgoingHttpHeaders => {
  return {
    "Content-Type": "application/x-ndjson; charset=UTF-8",
    "X-ClickHouse-Query-Id": crypto.randomUUID(),
    ...headers,
  };
};

const clickhouseError = (code: number, message: string, type: string): string => {
  return `Code: ${String(code)}. DB::Exception: ${message}. (${type}) (version 25.8.1.1 (official build))\n`;
};

beforeAll(async () => {
  server = http.createServer((request, response) => {
    let query = "";
    request.on("data", (chunk: Buffer) => (query += chunk.toString()));
    request.on("end", () => {
      respond(response, query, new URL(request.url ?? "/", "http://localhost"));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  connectionString = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/default`;
  Object.assign(runtimeConfig, { allowedPrivateHosts: new URL(connectionString).host });
});

afterEach(() => {
  resolveDns.mockReset();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("ClickHouse driver", () => {
  const run = (): Promise<unknown[]> => {
    return driver.execute({ config: { connectionString, authType: "none" } }, "SELECT 1", settings);
  };

  it("does not connect to a private host that is not allowed", async () => {
    resolveDns.mockImplementation((_hostname, _options, callback) => {
      callback(null, [{ address: "10.91.146.119", family: 4 }]);
    });
    const config = { connectionString: "http://db.internal:8123/default", authType: "none" };
    await expect(driver.execute({ config }, "SELECT 1", settings)).rejects.toThrow("private IP address");
  });

  it("returns the rows of ClickHouse", async () => {
    respond = (response) => {
      response.writeHead(200, clickhouseHeaders()).end('{"id":1,"total":"10"}\n{"id":2,"total":"20"}\n');
    };

    expect(await run()).toEqual([
      { id: 1, total: "10" },
      { id: 2, total: "20" },
    ]);
  });

  it("reports the errors of ClickHouse", async () => {
    respond = (response) => {
      const headers = clickhouseHeaders({ "Content-Type": "text/plain", "X-ClickHouse-Exception-Code": "60" });
      response
        .writeHead(404, headers)
        .end(clickhouseError(60, "Unknown table expression identifier 'orders'", "UNKNOWN_TABLE"));
    };

    await expect(run()).rejects.toMatchObject({
      code: "60",
      message: "Unknown table expression identifier 'orders'. ",
    });
  });

  it("reports the error of a query that fails while streaming", async () => {
    // ClickHouse closes the connection after writing the error in several chunks
    respond = (response) => {
      response.writeHead(200, clickhouseHeaders());
      response.write('{"id":1}\n__exception__\r\nCode: 395. DB::Exception: Value passed');
      setTimeout(() => {
        response.write(
          " to 'throwIf' function is non-zero. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 25.8.1.1)\n",
        );
        setTimeout(() => response.socket?.destroy(), 10);
      }, 10);
    };

    await expect(run()).rejects.toMatchObject({
      code: "395",
      message: "Value passed to 'throwIf' function is non-zero. ",
    });
  });

  it("runs the query without the read-only setting for users that cannot set it", async () => {
    respond = (response, query, url) => {
      if (url.searchParams.get("readonly") === "1") {
        const headers = clickhouseHeaders({ "Content-Type": "text/plain", "X-ClickHouse-Exception-Code": "164" });
        response.writeHead(500, headers).end(clickhouseError(164, "Cannot modify 'readonly' setting", "READONLY"));
      } else if (query.includes("getSetting('readonly')")) {
        response.writeHead(200, clickhouseHeaders()).end('{"readonly":"2"}\n');
      } else {
        response.writeHead(200, clickhouseHeaders()).end(`{"limit":"${String(url.searchParams.get("limit"))}"}\n`);
      }
    };

    expect(await run()).toEqual([{ limit: "10" }]);
  });

  it("does not report what another server answers", async () => {
    const answers: [Respond, string][] = [
      [
        (response) => response.writeHead(403, { "Content-Type": "text/html" }).end("<h1>internal secret</h1>"),
        "The ClickHouse request failed with status 403 Forbidden",
      ],
      [
        (response) => response.writeHead(200, { "Content-Type": "text/plain" }).end("internal secret"),
        "Invalid response from ClickHouse",
      ],
      // Neither its rows when they are JSON
      [
        (response) => {
          return response.writeHead(200, { "Content-Type": "application/json" }).end('{"token":"internal secret"}\n');
        },
        "Invalid response from ClickHouse",
      ],
      // Nor what follows rows of ClickHouse that is not an error of ClickHouse
      [
        (response) => response.writeHead(200, clickhouseHeaders()).end('{"id":1}\ninternal secret\n'),
        "Invalid response from ClickHouse",
      ],
    ];

    for (const [answer, message] of answers) {
      respond = answer;
      await expect(run()).rejects.toThrow(message);
    }
  });
});
