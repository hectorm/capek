import { ClickHouseLogLevel, createClient as createClickhouseClient } from "@clickhouse/client";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { ClickhouseDatasourceType } from "#layers/datasources/shared/definitions/clickhouse";

export class ClickhouseDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<unknown[]> {
    const config = ClickhouseDatasourceType.configSchema.parse(params.config);
    const basic = config.authType === "basic" ? config : null;

    // The request outlasts the query, and errors are returned instead of logged
    const client = createClickhouseClient({
      url: config.connectionString,
      username: basic?.username,
      password: basic?.password,
      request_timeout: settings.requestTimeoutMs && settings.requestTimeoutMs + (settings.statementTimeoutMs ?? 0),
      log: { level: ClickHouseLogLevel.OFF },
    });

    try {
      const result = await client.query({
        query: sql,
        format: "JSONEachRow",
        clickhouse_settings: {
          readonly: "1",
          ...(settings.statementTimeoutMs
            ? {
                max_execution_time: Math.ceil(settings.statementTimeoutMs / 1000),
              }
            : {}),
          ...(settings.maxRows
            ? {
                limit: String(settings.maxRows),
              }
            : {}),
        },
      });
      return await result.json<Record<string, unknown>>();
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
