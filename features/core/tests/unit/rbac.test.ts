import { describe, expect, it } from "vitest";

import { CoreRolePermissions, Roles } from "#layers/core/shared/rbac";

describe("RBAC", () => {
  it("keeps members to their own records", () => {
    const granted = CoreRolePermissions[Roles.Member].filter((name) => /:(all|create)$/.test(name));
    expect(granted).toEqual([]);
  });
});
