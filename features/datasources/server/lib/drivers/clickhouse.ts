import { STATUS_CODES } from "node:http";

import type { ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";
import { ClickHouseError, ClickHouseLogLevel, createClient, parseError } from "@clickhouse/client";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { readBodyStart } from "#layers/core/server/lib/http";
import { connectionUrl } from "#layers/datasources/server/lib/drivers/common";
import { ResultTooLargeError } from "#layers/datasources/server/lib/errors";
import { ClickhouseDatasourceType } from "#layers/datasources/shared/definitions/clickhouse";

const URL_OPTIONS = new Set(["application", "compression_request", "compression_response"]);

const ERROR_BODY_MAX_BYTES = 16_384;

const READONLY_ERROR = "164";
const INVALID_RESPONSE_ERROR = "Invalid response from ClickHouse";

export class ClickhouseDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<Record<string, unknown>[]> {
    const config = ClickhouseDatasourceType.configSchema.parse(params.config);

    // The request outlasts the query, and errors are returned instead of logged
    const client = createClient({
      url: connectionUrl(config, URL_OPTIONS),
      request_timeout: settings.requestTimeoutMs && settings.requestTimeoutMs + (settings.statementTimeoutMs ?? 0),
      log: { level: ClickHouseLogLevel.OFF },
    });

    const queryId = crypto.randomUUID();
    const exec = async (clickhouseSettings: ClickHouseSettings) => {
      const result = await client.exec({
        query: `${sql.trim().replace(/;+$/, "")} \nFORMAT JSONEachRow`,
        query_id: queryId,
        abort_signal: settings.signal,
        clickhouse_settings: clickhouseSettings,
        ignore_error_response: true,
      });
      const status = result.http_status_code ?? 0;
      const headers = result.response_headers;
      const ok = status >= 200 && status < 300 && headers["x-clickhouse-exception-code"] === undefined;
      if (ok && headers["x-clickhouse-query-id"] !== undefined) {
        return result.stream;
      }
      const body = await readBodyStart(result.stream, ERROR_BODY_MAX_BYTES);
      const statusText = `${String(status)} ${STATUS_CODES[status] ?? ""}`.trim();
      throw this.toError(body, ok ? INVALID_RESPONSE_ERROR : `ClickHouse request failed: ${statusText}`);
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
      const stream = await exec({ ...limits, readonly: "1" }).catch(async (error: unknown) => {
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

      return await this.readRows(stream as AsyncIterable<Uint8Array>, settings);
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

  private async readRows(
    stream: AsyncIterable<Uint8Array>,
    settings: DatasourceQuerySettings,
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    const decoder = new TextDecoder();

    let text = "";
    let failed = false;
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        bytes += chunk.byteLength;
        if (settings.maxBytes && bytes > settings.maxBytes) {
          throw new ResultTooLargeError(settings.maxBytes);
        }

        text += decoder.decode(chunk, { stream: true });
        if (failed) {
          continue;
        }

        const lines = text.split("\n");
        text = lines.pop() ?? "";
        for (const [index, line] of lines.entries()) {
          try {
            rows.push(
              JSON.parse(line, (_key, value: unknown, context?: { source: string }) => {
                return typeof value === "number" && context && String(value) !== context.source
                  ? context.source
                  : value;
              }) as Record<string, unknown>,
            );
          } catch {
            failed = true;
            text = [...lines.slice(index), text].join("\n");
            break;
          }
          if (rows.length === settings.maxRows) {
            return rows;
          }
        }
      }
    } catch (error) {
      if (!failed) {
        throw error;
      }
    }

    text += decoder.decode();
    if (failed || text.trim()) {
      throw this.toError(text, INVALID_RESPONSE_ERROR);
    }
    return rows;
  }

  private toError(text: string, message: string): Error {
    const error = parseError(text);
    return error instanceof ClickHouseError ? error : new Error(message);
  }
}
