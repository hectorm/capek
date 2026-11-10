import * as mariadb from "mariadb";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { MariaDBDatasourceType } from "#layers/datasources/shared/definitions/mariadb";

export class MariaDBDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<unknown[]> {
    const config = MariaDBDatasourceType.configSchema.parse(params.config);

    const url = new URL(config.connectionString);
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
    try {
      connection = await mariadb.createConnection(url.toString());
      await connection.query("SET SESSION TRANSACTION READ ONLY");
      if (settings.statementTimeoutMs) {
        const isMariaDB = connection.serverVersion().includes("MariaDB");
        const timeoutSql = isMariaDB
          ? `SET max_statement_time = ${String(Math.ceil(settings.statementTimeoutMs / 1000))}`
          : `SET SESSION max_execution_time = ${String(settings.statementTimeoutMs)}`;
        await connection.query(timeoutSql).catch(() => undefined);
      }
      const result: unknown = await connection.query(this.prepareSql(sql, settings.maxRows));
      // Statements without a result set return the status of their execution instead of rows
      return Array.isArray(result) ? result.map((row: Record<string, unknown>) => this.toSerializable(row)) : [];
    } catch (error) {
      if (error instanceof Error && url.password) {
        error.message = error.message
          .replaceAll(url.password, "***")
          .replaceAll(decodeURIComponent(url.password), "***");
      }
      throw error;
    } finally {
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

  private prepareSql(sql: string, maxRows: number | undefined): string {
    const trimmed = sql.trimEnd().replace(/;$/, "");
    if (!maxRows) return trimmed;
    if (!/^\s*(select|with)\b/i.test(trimmed)) return trimmed;
    if (/\blimit\s+\d+\s*$/i.test(trimmed)) return trimmed;
    return `${trimmed}\nLIMIT ${String(maxRows)}`;
  }
}
