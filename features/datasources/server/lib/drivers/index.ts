import type { DatasourceConfig, DatasourceTypeDefinition } from "#layers/datasources/shared/datasource";
import { ClickhouseDriver } from "#layers/datasources/server/lib/drivers/clickhouse";
import { MariaDBDriver } from "#layers/datasources/server/lib/drivers/mariadb";
import { PostgresDriver } from "#layers/datasources/server/lib/drivers/postgres";
import { SqlServerDriver } from "#layers/datasources/server/lib/drivers/sqlserver";
import { ClickhouseDatasourceType } from "#layers/datasources/shared/definitions/clickhouse";
import { MariaDBDatasourceType } from "#layers/datasources/shared/definitions/mariadb";
import { PostgresDatasourceType } from "#layers/datasources/shared/definitions/postgres";
import { SqlServerDatasourceType } from "#layers/datasources/shared/definitions/sqlserver";

export interface DatasourceConnectionParams {
  config: DatasourceConfig;
}

export interface DatasourceQuerySettings {
  statementTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxRows?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

// Runs the queries of a type of datasource in read-only mode
export interface DatasourceDriver {
  readonly validationQuery: string;
  execute: (params: DatasourceConnectionParams, sql: string, settings: DatasourceQuerySettings) => Promise<unknown[]>;
}

export interface ServerDatasourceType {
  definition: DatasourceTypeDefinition;
  driver: DatasourceDriver;
}

export const datasourceTypes: readonly ServerDatasourceType[] = [
  { definition: ClickhouseDatasourceType, driver: new ClickhouseDriver() },
  { definition: MariaDBDatasourceType, driver: new MariaDBDriver() },
  { definition: PostgresDatasourceType, driver: new PostgresDriver() },
  { definition: SqlServerDatasourceType, driver: new SqlServerDriver() },
];

// Undefined for the datasources stored with a type that is no longer supported
export const findDatasourceType = (type: string): ServerDatasourceType | undefined => {
  return datasourceTypes.find((candidate) => candidate.definition.type === type);
};
