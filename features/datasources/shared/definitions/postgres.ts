import { defineUrlDatasourceType } from "#layers/datasources/shared/datasource";

export const PostgresDatasourceType = defineUrlDatasourceType({
  type: "postgres",
  label: "PostgreSQL",
  placeholder: "postgres://<host>:5432/<database>",
});
