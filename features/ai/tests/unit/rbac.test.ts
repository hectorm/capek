import { describe, expect, it } from "vitest";

import type { AiPermissionName } from "#layers/ai/shared/rbac";
import { AiPermissions, AiRolePermissions } from "#layers/ai/shared/rbac";
import { Roles } from "#layers/core/shared/rbac";

const permissionValues = new Set<string>(Object.values(AiPermissions));

describe("rbac ai", () => {
  it("defines the exact count of permissions", () => {
    expect(Object.keys(AiPermissions).length).toBe(59);
  });

  it("keeps the role permission counts locked", () => {
    expect(AiRolePermissions[Roles.Admin].length).toBe(32);
    expect(AiRolePermissions[Roles.Auditor].length).toBe(32);
    expect(AiRolePermissions[Roles.Creator].length).toBe(32);
    expect(AiRolePermissions[Roles.Member].length).toBe(28);
  });

  it("only grants permissions that exist", () => {
    for (const [role, perms] of Object.entries(AiRolePermissions)) {
      for (const perm of perms) {
        expect(permissionValues.has(perm), `${role} has unknown permission ${perm}`).toBe(true);
      }
    }
  });

  it("never lists a permission twice within a role", () => {
    for (const [role, perms] of Object.entries(AiRolePermissions)) {
      expect(new Set(perms).size, `${role} has duplicate permissions`).toBe(perms.length);
    }
  });

  it("keeps chats personal", () => {
    const chatAllPermissions: AiPermissionName[] = [
      AiPermissions.ChatReadAll,
      AiPermissions.ChatListAll,
      AiPermissions.ChatUpdateAll,
      AiPermissions.ChatDeleteAll,
    ];
    for (const [role, perms] of Object.entries(AiRolePermissions)) {
      const granted: readonly string[] = perms;
      for (const perm of chatAllPermissions) {
        expect(granted.includes(perm), `${role} must not hold ${perm}`).toBe(false);
      }
    }
  });

  it("does not let members create resources", () => {
    const member: readonly string[] = AiRolePermissions[Roles.Member];
    const createPermissions: AiPermissionName[] = [
      AiPermissions.AgentCreate,
      AiPermissions.LlmProviderCreate,
      AiPermissions.McpServerCreate,
      AiPermissions.SkillCreate,
    ];
    for (const perm of createPermissions) {
      expect(member.includes(perm)).toBe(false);
    }
    expect(member.includes(AiPermissions.ChatCreate)).toBe(true);
  });
});
