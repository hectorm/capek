import type { SecurityDefinition } from "#layers/core/server/lib/database/security";
import { sharedResourcePolicies } from "#layers/core/server/lib/database/security";
import { SourceResource } from "#layers/datasources/server/lib/resources";

export const datasourcesSecurity: SecurityDefinition = {
  sharedResources: [SourceResource],
  statements: () => [...sharedResourcePolicies(SourceResource)],
};
