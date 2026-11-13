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
  ): Promise<Record<string, unknown>[]> {
    const config = ClickhouseDatasourceType.configSchema.parse(params.config);

    // The request outlasts the query, and errors are returned instead of logged
    const client = createClickhouseClient({
      url: connectionUrl(config, URL_OPTIONS),
      request_timeout: settings.requestTimeoutMs && settings.requestTimeoutMs + (settings.statementTimeoutMs ?? 0),
      log: { level: ClickHouseLogLevel.OFF },
    });

    const queryId = crypto.randomUUID();
    const exec = (clickhouseSettings: ClickHouseSettings) => {
      return client.exec({
        query: `${sql.trim().replace(/;+$/, "")} \nFORMAT JSONEachRow`,
        query_id: queryId,
        abort_signal: settings.signal,
        clickhouse_settings: clickhouseSettings,
      });
    };

    const limits: ClickHouseSettings = {
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
    };
    let limited = true as boolean;

    try {
      const { stream } = await exec({ ...limits, readonly: "1" }).catch(async (error: unknown) => {
        if ((error as { code?: string }).code !== READONLY_ERROR) {
          throw error;
        }
        // Read-only users cannot set their mode again
        const mode = await this.readonlyMode(client);
        if (mode === 0) {
          throw error;
        }
        limited = mode !== 1;
        return exec(limited ? limits : {});
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
      if (!limited) {
        await client.command({ query: `KILL QUERY WHERE query_id = '${queryId}'` }).catch(() => undefined);
      }
      await client.close().catch(() => undefined);
    }
  }

  private async readonlyMode(client: ClickHouseClient): Promise<number> {
    const result = await client.query({ query: "SELECT getSetting('readonly') AS readonly", format: "JSONEachRow" });
    const [row] = await result.json<{ readonly: string }>();
    return Number(row?.readonly);
  }

  private parseRow(line: string): Record<string, unknown> {
    try {
      return JSON.parse(line, (_key, value: unknown, context?: { source: string }) => {
        return typeof value === "number" && context && String(value) !== context.source ? context.source : value;
      }) as Record<string, unknown>;
    } catch {
      throw new Error(line.trim().slice(0, 1000));
    }
  }
}
