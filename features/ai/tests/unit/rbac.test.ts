import { describe, expect, it } from "vitest";

import { AiPermissions, AiRolePermissions } from "#layers/ai/shared/rbac";
import { Roles } from "#layers/core/shared/rbac";

describe("RBAC", () => {
  it("keeps members to their own records and chats", () => {
    const granted = AiRolePermissions[Roles.Member].filter((name) => /:(all|create)$/.test(name));
    expect(granted).toEqual([AiPermissions.ChatCreate]);
  });

  it("keeps chats personal for every role", () => {
    for (const permissions of Object.values(AiRolePermissions)) {
      expect(permissions.filter((name) => /^ai_chat:.*:all$/.test(name))).toEqual([]);
    }
  });
});
