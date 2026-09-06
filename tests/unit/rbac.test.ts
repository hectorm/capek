import { describe, expect, it } from "vitest";

import type { PermissionName } from "~~/shared/rbac";
import { Permissions, RolePermissions, Roles } from "~~/shared/rbac";

const permissionValues = new Set<string>(Object.values(Permissions));

describe("rbac", () => {
  it("defines the exact count of permissions and roles", () => {
    expect(Object.keys(Permissions).length).toBe(80);
    expect(Object.keys(Roles).length).toBe(4);
  });

  it("keeps the role permission counts locked", () => {
    expect(RolePermissions[Roles.Admin].length).toBe(47);
    expect(RolePermissions[Roles.Auditor].length).toBe(38);
    expect(RolePermissions[Roles.Creator].length).toBe(38);
    expect(RolePermissions[Roles.Member].length).toBe(33);
  });

  it("only grants permissions that exist", () => {
    for (const [role, perms] of Object.entries(RolePermissions)) {
      for (const perm of perms) {
        expect(permissionValues.has(perm), `${role} has unknown permission ${perm}`).toBe(true);
      }
    }
  });

  it("never lists a permission twice within a role", () => {
    for (const [role, perms] of Object.entries(RolePermissions)) {
      expect(new Set(perms).size, `${role} has duplicate permissions`).toBe(perms.length);
    }
  });

  it("keeps chats personal", () => {
    const chatAllPermissions: PermissionName[] = [
      Permissions.ChatReadAll,
      Permissions.ChatListAll,
      Permissions.ChatUpdateAll,
      Permissions.ChatDeleteAll,
    ];
    for (const [role, perms] of Object.entries(RolePermissions)) {
      for (const perm of chatAllPermissions) {
        expect(perms.includes(perm), `${role} must not hold ${perm}`).toBe(false);
      }
    }
  });

  it("does not let members create resources", () => {
    const createPermissions: PermissionName[] = [
      Permissions.UserCreate,
      Permissions.GroupCreate,
      Permissions.SettingsCreate,
      Permissions.AgentCreate,
      Permissions.LlmProviderCreate,
      Permissions.McpServerCreate,
      Permissions.SkillCreate,
    ];
    for (const perm of createPermissions) {
      expect(RolePermissions[Roles.Member].includes(perm)).toBe(false);
    }
    expect(RolePermissions[Roles.Member].includes(Permissions.ChatCreate)).toBe(true);
  });

  it("only grants :all scopes to the admin and auditor directories", () => {
    expect(RolePermissions[Roles.Member].includes(Permissions.UserListAll)).toBe(false);
    expect(RolePermissions[Roles.Member].includes(Permissions.UserReadAll)).toBe(false);
    expect(RolePermissions[Roles.Member].includes(Permissions.UserReadOwn)).toBe(true);
  });
});
