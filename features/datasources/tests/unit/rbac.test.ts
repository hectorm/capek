import { describe, expect, it } from "vitest";

import { Roles } from "#layers/core/shared/rbac";
import { DatasourcesRolePermissions } from "#layers/datasources/shared/rbac";

describe("RBAC", () => {
  it("keeps members to their own records", () => {
    const granted = DatasourcesRolePermissions[Roles.Member].filter((name) => /:(all|create)$/.test(name));
    expect(granted).toEqual([]);
  });
});
