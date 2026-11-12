import { Buffer } from "node:buffer";

import * as mariadb from "mariadb";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { connectionUrl, toRow } from "#layers/datasources/server/lib/drivers/common";
import { ResultTooLargeError } from "#layers/datasources/server/lib/errors";
import { MariaDBDatasourceType } from "#layers/datasources/shared/definitions/mariadb";

const URL_OPTIONS = new Set(["ssl", "allowPublicKeyRetrieval", "compress", "charset", "collation", "timezone"]);

const STATEMENT_GRACE_MS = 1_000;

export class MariaDBDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<unknown[]> {
    const config = MariaDBDatasourceType.configSchema.parse(params.config);

    const url = connectionUrl(config, URL_OPTIONS);
    if (url.protocol === "mysql:") {
      url.protocol = "mariadb:";
    }

    if (settings.requestTimeoutMs) {
      url.searchParams.set("connectTimeout", String(settings.requestTimeoutMs));
    }
    // Dates are returned as text, since as objects they would shift with the time zone of the application
    url.searchParams.set("dateStrings", "true");
    // Each row is a packet, which is refused before it is buffered when it is larger
    if (settings.maxBytes) {
      url.searchParams.set("maxAllowedPacket", String(settings.maxBytes));
    }

    let connection: mariadb.Connection | undefined;
    let timeout: AbortSignal | undefined;
    const onAbort = (): void => connection?.destroy();
    try {
      settings.signal?.throwIfAborted();
      connection = await mariadb.createConnection(url.toString());
      settings.signal?.addEventListener("abort", onAbort, { once: true });
      settings.signal?.throwIfAborted();
      if (settings.statementTimeoutMs) {
        timeout = AbortSignal.timeout(settings.statementTimeoutMs + STATEMENT_GRACE_MS);
        timeout.addEventListener("abort", onAbort, { once: true });
      }
      await connection.query("SET SESSION TRANSACTION READ ONLY");
      if (settings.statementTimeoutMs) {
        const isMariaDB = connection.serverVersion().includes("MariaDB");
        const timeoutSql = isMariaDB
          ? `SET max_statement_time = ${String(Math.ceil(settings.statementTimeoutMs / 1000))}`
          : `SET SESSION max_execution_time = ${String(settings.statementTimeoutMs)}`;
        await connection.query(timeoutSql).catch(() => undefined);
      }
      if (settings.maxRows) {
        await connection.query(`SET sql_select_limit = ${String(settings.maxRows)}`);
      }

      const rows: Record<string, unknown>[] = [];
      let bytes = 0;
      const stream = connection.queryStream({ sql, rowsAsArray: true });
      let columns: string[] | undefined;
      stream.once("fields", (fields: { name: () => string }[]) => {
        columns = fields.map((field) => field.name());
      });
      for await (const values of stream) {
        if (!columns) {
          continue;
        }
        if (settings.maxRows && rows.length >= settings.maxRows) {
          connection.destroy();
          break;
        }
        const serializable = this.toSerializable(toRow(columns, values as unknown[]));
        rows.push(serializable);
        bytes += Buffer.byteLength(JSON.stringify(serializable));
        if (settings.maxBytes && bytes > settings.maxBytes) {
          connection.destroy();
          throw new ResultTooLargeError(settings.maxBytes);
        }
      }
      return rows;
    } catch (error) {
      if (timeout?.aborted) {
        throw new Error("The query took longer than the time it is allowed to run");
      }
      if ((error as { code?: string }).code === "ER_UNEXPECTED_PACKET" && settings.maxBytes) {
        throw new ResultTooLargeError(settings.maxBytes);
      }
      if (error instanceof Error && url.password) {
        error.message = error.message
          .replaceAll(url.password, "***")
          .replaceAll(decodeURIComponent(url.password), "***");
      }
      throw error;
    } finally {
      timeout?.removeEventListener("abort", onAbort);
      settings.signal?.removeEventListener("abort", onAbort);
      await connection?.end().catch(() => undefined);
    }
  }

  // BIGINT values, like the result of COUNT, become numbers when they are safe integers and texts otherwise
  private toSerializable(row: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "bigint" ? (Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()) : value,
      ]),
    );
  }
}
