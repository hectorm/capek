import { defineUrlDatasourceType } from "#layers/datasources/shared/datasource";

export const ClickhouseDatasourceType = defineUrlDatasourceType({
  type: "clickhouse",
  label: "ClickHouse",
  placeholder: "http://<host>:8123/<database>",
});
