import { describe, expect, it } from "vitest";

import { datasourceTypes } from "#layers/datasources/server/lib/drivers";
import { DatasourceTypes } from "#layers/datasources/shared/definitions";

describe("datasource types", () => {
  it("are the same in the browser and in the server", () => {
    expect(datasourceTypes.map((type) => type.definition)).toEqual(DatasourceTypes);
  });
});
