import { Buffer } from "node:buffer";

import * as mariadb from "mariadb";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { pinnedSockets } from "#layers/core/server/lib/network";
import { connectionUrl, toRow } from "#layers/datasources/server/lib/drivers/common";
import { ResultTooLargeError } from "#layers/datasources/server/lib/errors";
import { MariaDBDatasourceType } from "#layers/datasources/shared/definitions/mariadb";

// Options parsed from a connection string, whose collation is an object that connections only take by name
type ParsedOptions = Omit<mariadb.ConnectionConfig, "collation"> & {
  host: string;
  port: number;
  collation?: { name: string };
};

const URL_OPTIONS = new Set(["ssl", "allowPublicKeyRetrieval", "compress", "charset", "collation", "timezone"]);

export class MariaDBDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<Record<string, unknown>[]> {
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
    let stop: (() => void) | undefined;
    const onAbort = (): void => stop?.();
    try {
      settings.signal?.throwIfAborted();
      const { collation, ...options } = mariadb.defaultOptions(url.toString()) as ParsedOptions;
      const sockets = pinnedSockets(options.host, options.port);
      const connectionConfig: mariadb.ConnectionConfig = {
        ...options,
        collation: collation?.name,
        permitRedirect: false,
        stream: (callback) => {
          try {
            callback(undefined, sockets().connect().setNoDelay(true));
          } catch (error) {
            callback(error as Error);
          }
        },
      };
      let opened = false;
      connection = await mariadb.createConnection({
        ...connectionConfig,
        stream: (callback) => {
          if (opened) {
            callback(new Error("The query is killed through another connection"));
            return;
          }
          opened = true;
          connectionConfig.stream?.(callback);
        },
      });
      const { threadId } = connection;
      stop = () => {
        connection?.destroy();
        void mariadb
          .createConnection({ ...connectionConfig, socketTimeout: settings.requestTimeoutMs })
          .then((killer) => killer.query(`KILL ${String(threadId)}`).finally(() => killer.end()))
          .catch(() => undefined);
      };
      settings.signal?.addEventListener("abort", onAbort, { once: true });
      settings.signal?.throwIfAborted();
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
          stop();
          break;
        }
        const serializable = this.toSerializable(toRow(columns, values as unknown[]));
        rows.push(serializable);
        bytes += Buffer.byteLength(JSON.stringify(serializable));
        if (settings.maxBytes && bytes > settings.maxBytes) {
          stop();
          throw new ResultTooLargeError(settings.maxBytes);
        }
      }
      return rows;
    } catch (error) {
      settings.signal?.throwIfAborted();
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
