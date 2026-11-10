import { defineSharedResource } from "#layers/core/server/lib/authz/resources";

export const SourceResource = defineSharedResource({
  type: "datasources_source",
  table: "datasources_sources",
  foreignKey: "source_id",
});
