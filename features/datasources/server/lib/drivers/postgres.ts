import pg from "pg";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { PostgresDatasourceType } from "#layers/datasources/shared/definitions/postgres";

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

      const query: pg.QueryConfig & { queryMode: "extended" } = {
        text: this.prepareSql(sql, settings.maxRows),
        queryMode: "extended",
      };
      return (await client.query<Record<string, unknown>>(query)).rows;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private prepareSql(sql: string, maxRows: number | undefined): string {
    const trimmed = sql.trimEnd().replace(/;$/, "");
    if (!maxRows) return trimmed;
    if (!/^\s*(select|with)\b/i.test(trimmed)) return trimmed;
    if (/\blimit\s+\d+\s*$/i.test(trimmed)) return trimmed;
    return `${trimmed}\nLIMIT ${String(maxRows)}`;
  }
}
