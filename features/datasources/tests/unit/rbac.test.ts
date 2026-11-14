import { describe, expect, it } from "vitest";

import { Roles } from "#layers/core/shared/rbac";
import { DatasourcesRolePermissions } from "#layers/datasources/shared/rbac";

describe("RBAC", () => {
  it("keeps members to their own records", () => {
    const granted = DatasourcesRolePermissions[Roles.Member].filter((name) => /:(all|create)$/.test(name));
    expect(granted).toEqual([]);
  });

  it("only gives auditors more reading than members", () => {
    const member: readonly string[] = DatasourcesRolePermissions[Roles.Member];
    const extra = DatasourcesRolePermissions[Roles.Auditor].filter((name) => !member.includes(name));
    expect(extra.filter((name) => !/:(read|list):all$/.test(name))).toEqual([]);
  });
});
