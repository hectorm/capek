import type { DatasourceTypeDefinition } from "#layers/datasources/shared/datasource";
import { ClickhouseDatasourceType } from "#layers/datasources/shared/definitions/clickhouse";
import { MariaDBDatasourceType } from "#layers/datasources/shared/definitions/mariadb";
import { PostgresDatasourceType } from "#layers/datasources/shared/definitions/postgres";
import { SqlServerDatasourceType } from "#layers/datasources/shared/definitions/sqlserver";

export const DatasourceTypes: readonly DatasourceTypeDefinition[] = [
  ClickhouseDatasourceType,
  MariaDBDatasourceType,
  PostgresDatasourceType,
  SqlServerDatasourceType,
];
