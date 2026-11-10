import type { SourceAccessTable, SourcesTable } from "#layers/datasources/shared/schema";

declare module "#layers/core/shared/schema" {
  interface Database {
    datasourcesSources: SourcesTable;
    datasourcesSourceAccess: SourceAccessTable;
  }
}
