import pg from "pg";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
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

    const client = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: settings.requestTimeoutMs,
    });

    try {
      await client.connect();
      await client.query("BEGIN TRANSACTION READ ONLY");
      if (settings.statementTimeoutMs) {
        await client.query(`SET LOCAL statement_timeout = ${String(settings.statementTimeoutMs)}`);
      }

      const run = (text: string): Promise<Record<string, unknown>[]> => {
        return new Promise((resolve, reject) => {
          const rows: Record<string, unknown>[] = [];
          const queryConfig: pg.QueryConfig & { queryMode: "extended" } = { text, queryMode: "extended" };
          const query = client.query(new pg.Query<Record<string, unknown>>(queryConfig));
          query.on("row", (row) => {
            if (settings.maxRows && rows.length >= settings.maxRows) {
              resolve(rows);
              return;
            }
            rows.push(row);
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
      await client.end().catch(() => undefined);
    }
  }
}
