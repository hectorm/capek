import { defineUrlDatasourceType } from "#layers/datasources/shared/datasource";

export const MariaDBDatasourceType = defineUrlDatasourceType({
  type: "mariadb",
  label: "MariaDB / MySQL",
  placeholder: "mariadb://<host>:3306/<database>",
});
