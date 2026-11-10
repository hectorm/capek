import { describe, expect, it } from "vitest";

import { Roles } from "#layers/core/shared/rbac";
import { DatasourcesPermissions, DatasourcesRolePermissions } from "#layers/datasources/shared/rbac";

describe("datasources rbac", () => {
  it("defines the expected permissions", () => {
    expect(Object.keys(DatasourcesPermissions).length).toBe(11);
    expect(Object.values(DatasourcesPermissions).every((name) => name.startsWith("datasources_"))).toBe(true);
  });

  it("grants the expected permissions to each role", () => {
    expect(DatasourcesRolePermissions[Roles.Admin].length).toBe(6);
    expect(DatasourcesRolePermissions[Roles.Auditor].length).toBe(6);
    expect(DatasourcesRolePermissions[Roles.Creator].length).toBe(6);
    expect(DatasourcesRolePermissions[Roles.Member].length).toBe(5);
    expect(DatasourcesRolePermissions[Roles.Member]).not.toContain(DatasourcesPermissions.SourceCreate);
  });
});
