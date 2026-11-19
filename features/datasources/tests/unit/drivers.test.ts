import { expect, it } from "vitest";

import { datasourceTypes } from "#layers/datasources/server/lib/drivers";
import { DatasourceTypes } from "#layers/datasources/shared/definitions";

it("has the same datasource types in the browser and in the server", () => {
  expect(datasourceTypes.map((type) => type.definition)).toEqual(DatasourceTypes);
});
