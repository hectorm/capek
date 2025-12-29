import type { PermissionName } from "~~/shared/rbac";
import { useUserStore } from "~/stores/user";

export const usePermissions = () => {
  const userStore = useUserStore();

  const check = (
    permission: PermissionName,
    user: NonNullable<typeof userStore.user>,
    ownerIds: string[] | undefined,
  ): boolean => {
    if (!user.permissions.includes(permission)) {
      return false;
    }

    if (permission.endsWith(":own") && ownerIds !== undefined) {
      return ownerIds.includes(user.id) || user.groups.some((id) => ownerIds.includes(id));
    }

    return true;
  };

  const can = (permissions: PermissionName | PermissionName[], ownerIds?: string[]): boolean => {
    const user = userStore.user;
    if (!user?.permissions) {
      return false;
    }

    return Array.isArray(permissions)
      ? permissions.every((p) => check(p, user, ownerIds))
      : check(permissions, user, ownerIds);
  };

  const canAny = (permissions: PermissionName | PermissionName[], ownerIds?: string[]): boolean => {
    const user = userStore.user;
    if (!user?.permissions) {
      return false;
    }

    return Array.isArray(permissions)
      ? permissions.some((p) => check(p, user, ownerIds))
      : check(permissions, user, ownerIds);
  };

  return { can, canAny };
};
