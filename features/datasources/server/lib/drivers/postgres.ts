import pg from "pg";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { ResultTooLargeError } from "#layers/datasources/server/lib/errors";
import { PostgresDatasourceType } from "#layers/datasources/shared/definitions/postgres";

const SYNTAX_ERROR = "42601";

export class PostgresDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<unknown[]> {
    const config = PostgresDatasourceType.configSchema.parse(params.config);

    const url = new URL(config.connectionString);
    if (config.authType === "basic") {
      url.username = config.username;
      url.password = config.password;
    }

    const clientConfig = { connectionString: url.toString(), connectionTimeoutMillis: settings.requestTimeoutMs };
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
    const onAbort = (): void => void cancel();

    try {
      settings.signal?.throwIfAborted();
      await client.connect();
      if (settings.signal) {
        const backend = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pid = backend.rows[0]?.pid;
        settings.signal.addEventListener("abort", onAbort, { once: true });
      }
      await client.query("BEGIN TRANSACTION READ ONLY");
      if (settings.statementTimeoutMs) {
        await client.query(`SET LOCAL statement_timeout = ${String(settings.statementTimeoutMs)}`);
      }

      const run = (text: string): Promise<Record<string, unknown>[]> => {
        return new Promise((resolve, reject) => {
          const rows: Record<string, unknown>[] = [];
          let chars = 0;
          const queryConfig: pg.QueryConfig & { queryMode: "extended" } = { text, queryMode: "extended" };
          const query = client.query(new pg.Query<Record<string, unknown>>(queryConfig));
          query.on("row", (row) => {
            if (settings.maxRows && rows.length >= settings.maxRows) {
              resolve(rows);
              return;
            }
            rows.push(row);
            chars += JSON.stringify(row).length;
            if (settings.maxChars && chars > settings.maxChars) {
              reject(new ResultTooLargeError(settings.maxChars));
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
