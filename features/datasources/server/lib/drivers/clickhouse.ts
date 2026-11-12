import type { ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";
import { ClickHouseLogLevel, createClient as createClickhouseClient } from "@clickhouse/client";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { connectionUrl } from "#layers/datasources/server/lib/drivers/common";
import { ResultTooLargeError } from "#layers/datasources/server/lib/errors";
import { ClickhouseDatasourceType } from "#layers/datasources/shared/definitions/clickhouse";

const URL_OPTIONS = new Set(["application", "compression_request", "compression_response"]);

const READONLY_ERROR = "164";

export class ClickhouseDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<unknown[]> {
    const config = ClickhouseDatasourceType.configSchema.parse(params.config);

    // The request outlasts the query, and errors are returned instead of logged
    const client = createClickhouseClient({
      url: connectionUrl(config, URL_OPTIONS),
      request_timeout: settings.requestTimeoutMs && settings.requestTimeoutMs + (settings.statementTimeoutMs ?? 0),
      log: { level: ClickHouseLogLevel.OFF },
    });

    const exec = (clickhouseSettings: ClickHouseSettings) => {
      return client.exec({
        query: `${sql.trim().replace(/;+$/, "")} \nFORMAT JSONEachRow`,
        abort_signal: settings.signal,
        clickhouse_settings: clickhouseSettings,
      });
    };

    try {
      const { stream } = await exec({
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
      }).catch(async (error: unknown) => {
        if ((error as { code?: string }).code !== READONLY_ERROR || !(await this.isReadonly(client))) {
          throw error;
        }
        return exec({});
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
        if (settings.maxRows && rows.length >= settings.maxRows) {
          return rows.slice(0, settings.maxRows);
        }
      }
      const rest = pending + decoder.decode();
      if (rest.trim()) {
        rows.push(this.parseRow(rest));
      }
      return rows.slice(0, settings.maxRows);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async isReadonly(client: ClickHouseClient): Promise<boolean> {
    const result = await client.query({ query: "SELECT getSetting('readonly') AS readonly", format: "JSONEachRow" });
    const [row] = await result.json<{ readonly: string }>();
    return Number(row?.readonly) > 0;
  }

  private parseRow(line: string): Record<string, unknown> {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(line.trim().slice(0, 1000));
    }
  }
}
