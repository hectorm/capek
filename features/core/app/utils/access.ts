import type { Principal, PrincipalAccess, PrincipalRole } from "#layers/core/shared/rbac";

// IDs of the principals holding a role, in the "<type>:<id>" format of the search fields
export const toPrincipalIds = (access: Principal[], role: PrincipalRole): string[] => {
  return access.filter((a) => a.role === role).map((a) => `${a.type}:${a.id}`);
};

export const fromPrincipalIds = (selection: { editors: string[]; users: string[] }): PrincipalAccess[] => {
  const toAccess = (compositeId: string, role: PrincipalRole): PrincipalAccess => {
    const [type, id] = compositeId.split(":");
    return { id: id ?? "", type: type as PrincipalAccess["type"], role };
  };
  return [
    ...selection.editors.map((compositeId) => toAccess(compositeId, "editor")),
    ...selection.users.map((compositeId) => toAccess(compositeId, "user")),
  ];
};
