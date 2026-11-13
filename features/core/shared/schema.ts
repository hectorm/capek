import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";

////////////////////////////////

export interface UsersTable {
  id: ColumnType<string, string | undefined, never>;
  username: string;
  fullname: string;
  email: string;
  picture: string | null;
  lastLoginAt: ColumnType<Date, never, Date> | null;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

////////////////////////////////

export interface GroupsTable {
  id: ColumnType<string, string | undefined, never>;
  name: string;
  description: string;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type Group = Selectable<GroupsTable>;
export type NewGroup = Insertable<GroupsTable>;
export type GroupUpdate = Updateable<GroupsTable>;

////////////////////////////////

export interface RolesTable {
  id: ColumnType<string, never, never>;
  name: string;
  createdAt: ColumnType<Date, never, never>;
}

export type Role = Selectable<RolesTable>;
export type NewRole = Insertable<RolesTable>;
export type RoleUpdate = Updateable<RolesTable>;

////////////////////////////////

export interface PermissionsTable {
  id: ColumnType<string, never, never>;
  name: string;
  createdAt: ColumnType<Date, never, never>;
}

export type Permission = Selectable<PermissionsTable>;
export type NewPermission = Insertable<PermissionsTable>;
export type PermissionUpdate = Updateable<PermissionsTable>;

////////////////////////////////

export interface UserGroupsTable {
  userId: ColumnType<string, string, never>;
  groupId: ColumnType<string, string, never>;
  createdAt: ColumnType<Date, never, never>;
}

export type UserGroup = Selectable<UserGroupsTable>;
export type NewUserGroup = Insertable<UserGroupsTable>;

////////////////////////////////

export interface UserRolesTable {
  userId: ColumnType<string, string, never>;
  roleId: ColumnType<string, string, never>;
  createdAt: ColumnType<Date, never, never>;
}

export type UserRole = Selectable<UserRolesTable>;
export type NewUserRole = Insertable<UserRolesTable>;

////////////////////////////////

export interface GroupRolesTable {
  groupId: ColumnType<string, string, never>;
  roleId: ColumnType<string, string, never>;
  createdAt: ColumnType<Date, never, never>;
}

export type GroupRole = Selectable<GroupRolesTable>;
export type NewGroupRole = Insertable<GroupRolesTable>;

////////////////////////////////

export interface RolePermissionsTable {
  roleId: ColumnType<string, string, never>;
  permissionId: ColumnType<string, string, never>;
  createdAt: ColumnType<Date, never, never>;
}

export type RolePermission = Selectable<RolePermissionsTable>;
export type NewRolePermission = Insertable<RolePermissionsTable>;

////////////////////////////////

export interface AccountsTable {
  id: ColumnType<string, never, never>;
  userId: ColumnType<string, string, never>;
  iss: string;
  sub: string;
  createdAt: ColumnType<Date, never, never>;
}

export type Account = Selectable<AccountsTable>;
export type NewAccount = Insertable<AccountsTable>;
export type AccountUpdate = Updateable<AccountsTable>;

////////////////////////////////

export interface SessionsTable {
  id: ColumnType<string, never, never>;
  userId: ColumnType<string, string, never>;
  token: string;
  sid: string | null;
  idToken: string | null;
  createdAt: ColumnType<Date, never, never>;
  expiresAt: ColumnType<Date, Date, Date>;
}

export type Session = Selectable<SessionsTable>;
export type NewSession = Insertable<SessionsTable>;
export type SessionUpdate = Updateable<SessionsTable>;

////////////////////////////////

export interface SettingsTable {
  key: string;
  value: string | string[] | number | boolean | null;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type Setting = Selectable<SettingsTable>;
export type NewSetting = Insertable<SettingsTable>;
export type SettingUpdate = Updateable<SettingsTable>;

////////////////////////////////

export interface EncryptionKeysTable {
  version: number;
  wrappedKey: string;
  mainKeyFingerprint: string;
  createdAt: ColumnType<Date, never, never>;
}

export type EncryptionKey = Selectable<EncryptionKeysTable>;
export type NewEncryptionKey = Insertable<EncryptionKeysTable>;
export type EncryptionKeyUpdate = Updateable<EncryptionKeysTable>;

////////////////////////////////

// Access entries of a resource shared with users and groups, see `defineSharedResource()`
export type ResourceAccessTable<K extends string> = {
  id: ColumnType<number, never, never>;
  userId: string | null;
  groupId: string | null;
  role: "editor" | "user";
  createdAt: ColumnType<Date, never, never>;
} & Record<K, ColumnType<string, string, never>>;

////////////////////////////////

// Database tables of each feature, registered through declaration merging
export interface Database {
  users: UsersTable;
  groups: GroupsTable;
  roles: RolesTable;
  permissions: PermissionsTable;
  userGroups: UserGroupsTable;
  userRoles: UserRolesTable;
  groupRoles: GroupRolesTable;
  rolePermissions: RolePermissionsTable;
  accounts: AccountsTable;
  sessions: SessionsTable;
  settings: SettingsTable;
  encryptionKeys: EncryptionKeysTable;
}
