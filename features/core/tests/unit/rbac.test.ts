import { describe, expect, it } from "vitest";

import { CorePermissions, CoreRolePermissions, Roles } from "#layers/core/shared/rbac";

const permissionValues = new Set<string>(Object.values(CorePermissions));

describe("rbac core", () => {
  it("defines the exact count of permissions and roles", () => {
    expect(Object.keys(CorePermissions).length).toBe(21);
    expect(Object.keys(Roles).length).toBe(4);
  });

  it("keeps the role permission counts locked", () => {
    expect(CoreRolePermissions[Roles.Admin].length).toBe(15);
    expect(CoreRolePermissions[Roles.Auditor].length).toBe(6);
    expect(CoreRolePermissions[Roles.Creator].length).toBe(6);
    expect(CoreRolePermissions[Roles.Member].length).toBe(5);
  });

  it("only grants permissions that exist", () => {
    for (const [role, perms] of Object.entries(CoreRolePermissions)) {
      for (const perm of perms) {
        expect(permissionValues.has(perm), `${role} has unknown permission ${perm}`).toBe(true);
      }
    }
  });

  it("never lists a permission twice within a role", () => {
    for (const [role, perms] of Object.entries(CoreRolePermissions)) {
      expect(new Set(perms).size, `${role} has duplicate permissions`).toBe(perms.length);
    }
  });

  it("does not let members manage users, groups or settings", () => {
    const member: readonly string[] = CoreRolePermissions[Roles.Member];
    for (const perm of [CorePermissions.UserCreate, CorePermissions.GroupCreate, CorePermissions.SettingsCreate]) {
      expect(member.includes(perm)).toBe(false);
    }
  });

  it("only grants :all scopes to the admin and auditor directories", () => {
    const member: readonly string[] = CoreRolePermissions[Roles.Member];
    expect(member.includes(CorePermissions.UserListAll)).toBe(false);
    expect(member.includes(CorePermissions.UserReadAll)).toBe(false);
    expect(member.includes(CorePermissions.UserReadOwn)).toBe(true);
  });
});
