import type { Principal, PrincipalAccess, PrincipalRole, UserPrincipal } from "#layers/core/shared/rbac";

// Search fields identify each principal as <type>:<id>
export const toPrincipalIds = (access: Principal[]): { editors: string[]; users: string[] } => {
  const withRole = (role: PrincipalRole): string[] => {
    return access.filter((a) => a.role === role).map((a) => `${a.type}:${a.id}`);
  };
  return { editors: withRole("editor"), users: withRole("user") };
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

// The :own permission treats resource editors as owners
export const toOwnerIds = (access: Principal[]): string[] => {
  return access.filter((a) => a.role === "editor").map((a) => a.id);
};

export const creatorAccess = (user: Pick<UserPrincipal, "id" | "username" | "email">): Principal[] => {
  const { id, username, email } = user;
  return [
    { id, type: "user", role: "editor", username, email },
    { id, type: "user", role: "user", username, email },
  ];
};
