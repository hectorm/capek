import { z } from "zod/v4";

export const Roles = {
  Admin: "admin",
  Auditor: "auditor",
  Creator: "creator",
  Member: "member",
} as const;

export type RoleName = (typeof Roles)[keyof typeof Roles];

export const CorePermissions = {
  UserReadAll: "user:read:all",
  UserReadOwn: "user:read:own",
  UserListAll: "user:list:all",
  UserCreate: "user:create",
  UserUpdateAll: "user:update:all",
  UserUpdateOwn: "user:update:own",
  UserDeleteAll: "user:delete:all",

  GroupReadAll: "group:read:all",
  GroupReadOwn: "group:read:own",
  GroupListAll: "group:list:all",
  GroupListOwn: "group:list:own",
  GroupCreate: "group:create",
  GroupUpdateAll: "group:update:all",
  GroupDeleteAll: "group:delete:all",

  SettingsReadAll: "settings:read:all",
  SettingsReadPublic: "settings:read:public",
  SettingsListAll: "settings:list:all",
  SettingsListPublic: "settings:list:public",
  SettingsCreate: "settings:create",
  SettingsUpdateAll: "settings:update:all",
  SettingsDeleteAll: "settings:delete:all",
} as const;

export type CorePermissionName = (typeof CorePermissions)[keyof typeof CorePermissions];

// Permission names of each feature, registered through declaration merging
export interface PermissionRegistry {
  core: CorePermissionName;
}

export type PermissionName = PermissionRegistry[keyof PermissionRegistry];

export const CoreRolePermissions = {
  [Roles.Admin]: [
    CorePermissions.UserReadAll,
    CorePermissions.UserListAll,
    CorePermissions.UserCreate,
    CorePermissions.UserUpdateAll,
    CorePermissions.UserDeleteAll,

    CorePermissions.GroupReadAll,
    CorePermissions.GroupListAll,
    CorePermissions.GroupCreate,
    CorePermissions.GroupUpdateAll,
    CorePermissions.GroupDeleteAll,

    CorePermissions.SettingsReadAll,
    CorePermissions.SettingsListAll,
    CorePermissions.SettingsCreate,
    CorePermissions.SettingsUpdateAll,
    CorePermissions.SettingsDeleteAll,
  ],
  [Roles.Auditor]: [
    CorePermissions.UserReadAll,
    CorePermissions.UserListAll,

    CorePermissions.GroupReadAll,
    CorePermissions.GroupListAll,

    CorePermissions.SettingsReadAll,
    CorePermissions.SettingsListAll,
  ],
  [Roles.Creator]: [
    CorePermissions.UserReadAll,
    CorePermissions.UserListAll,

    CorePermissions.GroupReadAll,
    CorePermissions.GroupListAll,

    CorePermissions.SettingsReadPublic,
    CorePermissions.SettingsListPublic,
  ],
  [Roles.Member]: [
    CorePermissions.UserReadOwn,

    CorePermissions.GroupReadOwn,
    CorePermissions.GroupListOwn,

    CorePermissions.SettingsReadPublic,
    CorePermissions.SettingsListPublic,
  ],
} as const satisfies Record<RoleName, readonly CorePermissionName[]>;

export type PrincipalRole = "editor" | "user";

export interface UserPrincipal {
  id: string;
  type: "user";
  role: PrincipalRole;
  username: string;
  email: string;
}

export interface GroupPrincipal {
  id: string;
  type: "group";
  role: PrincipalRole;
  groupname: string;
}

export type Principal = UserPrincipal | GroupPrincipal;

// Access entry of a shared resource, as received by the `syncAccess` procedures
export const principalAccessSchema = z.object({
  id: z.uuid(),
  type: z.enum(["user", "group"]),
  role: z.enum(["editor", "user"]),
});

export type PrincipalAccess = z.infer<typeof principalAccessSchema>;
