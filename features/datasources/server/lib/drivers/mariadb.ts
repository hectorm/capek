import * as mariadb from "mariadb";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { ResultTooLargeError } from "#layers/datasources/server/lib/errors";
import { MariaDBDatasourceType } from "#layers/datasources/shared/definitions/mariadb";

const URL_OPTIONS = new Set(["ssl", "allowPublicKeyRetrieval", "compress", "charset", "collation", "timezone"]);

export class MariaDBDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<unknown[]> {
    const config = MariaDBDatasourceType.configSchema.parse(params.config);

    const url = new URL(config.connectionString);
    const unsupported = [...url.searchParams.keys()].find((name) => !URL_OPTIONS.has(name));
    if (unsupported) {
      throw new Error(`The option "${unsupported}" of the connection string is not supported`);
    }
    if (url.protocol === "mysql:") {
      url.protocol = "mariadb:";
    }
    if (config.authType === "basic") {
      url.username = config.username;
      url.password = config.password;
    }

    if (settings.requestTimeoutMs) {
      url.searchParams.set("connectTimeout", String(settings.requestTimeoutMs));
    }
    // Dates are returned as text, since as objects they would shift with the time zone of the application
    url.searchParams.set("dateStrings", "true");

    let connection: mariadb.Connection | undefined;
    const onAbort = (): void => connection?.destroy();
    try {
      settings.signal?.throwIfAborted();
      connection = await mariadb.createConnection(url.toString());
      settings.signal?.addEventListener("abort", onAbort, { once: true });
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
      let chars = 0;
      const stream = connection.queryStream(sql);
      let columns: unknown;
      stream.once("fields", (fields: unknown) => {
        columns = fields;
      });
      for await (const row of stream) {
        if (!columns) {
          continue;
        }
        if (settings.maxRows && rows.length >= settings.maxRows) {
          connection.destroy();
          break;
        }
        const serializable = this.toSerializable(row as Record<string, unknown>);
        rows.push(serializable);
        chars += JSON.stringify(serializable).length;
        if (settings.maxChars && chars > settings.maxChars) {
          connection.destroy();
          throw new ResultTooLargeError(settings.maxChars);
        }
      }
      return rows;
    } catch (error) {
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
