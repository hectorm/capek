import { ClickHouseLogLevel, createClient as createClickhouseClient } from "@clickhouse/client";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { ResultTooLargeError } from "#layers/datasources/server/lib/errors";
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
        abort_signal: settings.signal,
        clickhouse_settings: {
          readonly: "1",
          cancel_http_readonly_queries_on_client_close: 1,
          output_format_json_quote_64bit_integers: 1,
          output_format_json_quote_decimals: 1,
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

      const rows: Record<string, unknown>[] = [];
      let chars = 0;
      for await (const batch of result.stream()) {
        for (const row of batch) {
          chars += row.text.length;
          if (settings.maxChars && chars > settings.maxChars) {
            throw new ResultTooLargeError(settings.maxChars);
          }
          rows.push(row.json());
        }
      }
      return rows;
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
