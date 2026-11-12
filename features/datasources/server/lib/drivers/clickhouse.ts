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
      const { stream } = await client.exec({
        query: `${sql.trim().replace(/;+$/, "")} \nFORMAT JSONEachRow`,
        abort_signal: settings.signal,
        clickhouse_settings: {
          readonly: "1",
          cancel_http_readonly_queries_on_client_close: 1,
          output_format_json_quote_64bit_integers: 1,
          output_format_json_quote_decimals: 1,
          http_write_exception_in_output_format: 0,
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
      const decoder = new TextDecoder();
      let pending = "";
      let bytes = 0;
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength;
        if (settings.maxBytes && bytes > settings.maxBytes) {
          throw new ResultTooLargeError(settings.maxBytes);
        }

        const lines = (pending + decoder.decode(chunk, { stream: true })).split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          rows.push(this.parseRow(line));
        }
      }
      const rest = pending + decoder.decode();
      if (rest.trim()) {
        rows.push(this.parseRow(rest));
      }
      return rows;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private parseRow(line: string): Record<string, unknown> {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(line.trim().slice(0, 1000));
    }
  }
}
