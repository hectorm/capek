import { createError } from "h3";

import type { AuthUser } from "~~/server/lib/authn/strategies";
import type { PermissionName } from "~~/shared/rbac";

export const can = (user: AuthUser, permissions: PermissionName | PermissionName[]): boolean => {
  return Array.isArray(permissions)
    ? permissions.every((p) => user.permissions.includes(p))
    : user.permissions.includes(permissions);
};

export const canAny = (user: AuthUser, permissions: PermissionName | PermissionName[]): boolean => {
  return Array.isArray(permissions)
    ? permissions.some((p) => user.permissions.includes(p))
    : user.permissions.includes(permissions);
};

export const requirePermissions = (
  user: AuthUser | null | undefined,
  permissions: PermissionName | PermissionName[],
  strict = false,
): AuthUser => {
  if (!user) {
    throw createError({
      statusCode: 401,
      message: "Authentication required",
    });
  }

  if (!(strict ? can : canAny)(user, permissions)) {
    throw createError({
      statusCode: 403,
      message: "Insufficient permissions",
    });
  }

  return user;
};
