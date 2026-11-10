import type { RoleName } from "#layers/core/shared/rbac";
import { Roles } from "#layers/core/shared/rbac";

export const DatasourcesPermissions = {
  SourceReadAll: "datasources_source:read:all",
  SourceReadOwn: "datasources_source:read:own",
  SourceListAll: "datasources_source:list:all",
  SourceListOwn: "datasources_source:list:own",
  SourceCreate: "datasources_source:create",
  SourceUpdateAll: "datasources_source:update:all",
  SourceUpdateOwn: "datasources_source:update:own",
  SourceDeleteAll: "datasources_source:delete:all",
  SourceDeleteOwn: "datasources_source:delete:own",
  SourceUseAll: "datasources_source:use:all",
  SourceUseOwn: "datasources_source:use:own",
} as const;

export type DatasourcesPermissionName = (typeof DatasourcesPermissions)[keyof typeof DatasourcesPermissions];

declare module "#layers/core/shared/rbac" {
  interface PermissionRegistry {
    datasources: DatasourcesPermissionName;
  }
}

export const DatasourcesRolePermissions = {
  [Roles.Admin]: [
    DatasourcesPermissions.SourceReadAll,
    DatasourcesPermissions.SourceListAll,
    DatasourcesPermissions.SourceCreate,
    DatasourcesPermissions.SourceUpdateAll,
    DatasourcesPermissions.SourceDeleteAll,
    DatasourcesPermissions.SourceUseAll,
  ],
  [Roles.Auditor]: [
    DatasourcesPermissions.SourceReadAll,
    DatasourcesPermissions.SourceListAll,
    DatasourcesPermissions.SourceCreate,
    DatasourcesPermissions.SourceUpdateOwn,
    DatasourcesPermissions.SourceDeleteOwn,
    DatasourcesPermissions.SourceUseOwn,
  ],
  [Roles.Creator]: [
    DatasourcesPermissions.SourceReadOwn,
    DatasourcesPermissions.SourceListOwn,
    DatasourcesPermissions.SourceCreate,
    DatasourcesPermissions.SourceUpdateOwn,
    DatasourcesPermissions.SourceDeleteOwn,
    DatasourcesPermissions.SourceUseOwn,
  ],
  [Roles.Member]: [
    DatasourcesPermissions.SourceReadOwn,
    DatasourcesPermissions.SourceListOwn,
    DatasourcesPermissions.SourceUpdateOwn,
    DatasourcesPermissions.SourceDeleteOwn,
    DatasourcesPermissions.SourceUseOwn,
  ],
} as const satisfies Record<RoleName, readonly DatasourcesPermissionName[]>;
