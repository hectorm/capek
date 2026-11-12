import { Buffer } from "node:buffer";

import pg from "pg";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { connectionUrl, toRow } from "#layers/datasources/server/lib/drivers/common";
import { ResultTooLargeError } from "#layers/datasources/server/lib/errors";
import { PostgresDatasourceType } from "#layers/datasources/shared/definitions/postgres";

const URL_OPTIONS = new Set(["ssl", "sslmode", "application_name", "options"]);

const SYNTAX_ERROR = "42601";

const DATE_TYPES: ReadonlySet<unknown> = new Set([
  pg.types.builtins.DATE,
  pg.types.builtins.TIMESTAMP,
  pg.types.builtins.TIMESTAMPTZ,
]);
const types: pg.CustomTypesConfig = {
  getTypeParser: (oid, format) =>
    DATE_TYPES.has(oid) ? (value: string) => value : (pg.types.getTypeParser(oid, format) as unknown),
};

export class PostgresDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<unknown[]> {
    const config = PostgresDatasourceType.configSchema.parse(params.config);

    const url = connectionUrl(config, URL_OPTIONS);
    const clientConfig = {
      connectionString: url.toString(),
      connectionTimeoutMillis: settings.requestTimeoutMs,
      types,
    };
    const client = new pg.Client(clientConfig);

    let pid: number | undefined;
    const cancel = async (): Promise<void> => {
      const canceller = new pg.Client(clientConfig);
      try {
        await canceller.connect();
        await canceller.query("SELECT pg_cancel_backend($1)", [pid]);
      } catch {
        // ignore
      } finally {
        await canceller.end().catch(() => undefined);
      }
    };
    const onAbort = (): void => {
      void cancel();
      // The query would otherwise wait for a server that does not answer
      client.connection.stream.destroy();
    };

    client.on("error", () => undefined);

    try {
      settings.signal?.throwIfAborted();
      await client.connect();

      const { maxBytes } = settings;
      if (maxBytes) {
        let bytes = 0;
        client.connection.stream.on("data", (chunk: Uint8Array) => {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) {
            client.connection.stream.destroy(new ResultTooLargeError(maxBytes));
          }
        });
      }

      if (settings.signal) {
        const backend = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pid = backend.rows[0]?.pid;
        settings.signal.addEventListener("abort", onAbort, { once: true });
        settings.signal.throwIfAborted();
      }
      await client.query("BEGIN TRANSACTION READ ONLY");
      if (settings.statementTimeoutMs) {
        await client.query(`SET LOCAL statement_timeout = ${String(settings.statementTimeoutMs)}`);
      }

      const run = (text: string): Promise<Record<string, unknown>[]> => {
        return new Promise((resolve, reject) => {
          const rows: Record<string, unknown>[] = [];
          let bytes = 0;
          const queryConfig: pg.QueryArrayConfig & { queryMode: "extended" } = {
            text,
            rowMode: "array",
            queryMode: "extended",
          };
          const query = client.query(new pg.Query<unknown[]>(queryConfig));
          query.on("row", (values, result) => {
            if (settings.maxRows && rows.length >= settings.maxRows) {
              resolve(rows);
              return;
            }
            const row = toRow(result?.fields.map((field) => field.name) ?? [], values);
            rows.push(row);
            bytes += Buffer.byteLength(JSON.stringify(row));
            if (settings.maxBytes && bytes > settings.maxBytes) {
              reject(new ResultTooLargeError(settings.maxBytes));
            }
          });
          query.on("end", () => {
            resolve(rows);
          });
          query.on("error", reject);
        });
      };
      const statement = sql.trimEnd().replace(/;$/, "");
      if (!settings.maxRows) {
        return await run(statement);
      }
      await client.query("SAVEPOINT datasource_limit");
      try {
        return await run(`SELECT * FROM (\n${statement}\n) AS datasource_rows LIMIT ${String(settings.maxRows)}`);
      } catch (error) {
        if ((error as { code?: string }).code !== SYNTAX_ERROR) {
          throw error;
        }
        await client.query("ROLLBACK TO SAVEPOINT datasource_limit");
        return await run(statement);
      }
    } finally {
      settings.signal?.removeEventListener("abort", onAbort);
      await client.end().catch(() => undefined);
    }
  }
}
