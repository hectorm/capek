export const Roles = {
  Admin: "admin",
  Auditor: "auditor",
  Creator: "creator",
  Member: "member",
} as const;

export type RoleName = (typeof Roles)[keyof typeof Roles];

export const Permissions = {
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

  ChatReadAll: "chat:read:all",
  ChatReadOwn: "chat:read:own",
  ChatListAll: "chat:list:all",
  ChatListOwn: "chat:list:own",
  ChatCreate: "chat:create",
  ChatUpdateAll: "chat:update:all",
  ChatUpdateOwn: "chat:update:own",
  ChatDeleteAll: "chat:delete:all",
  ChatDeleteOwn: "chat:delete:own",

  AgentReadAll: "agent:read:all",
  AgentReadOwn: "agent:read:own",
  AgentListAll: "agent:list:all",
  AgentListOwn: "agent:list:own",
  AgentCreate: "agent:create",
  AgentUpdateAll: "agent:update:all",
  AgentUpdateOwn: "agent:update:own",
  AgentDeleteAll: "agent:delete:all",
  AgentDeleteOwn: "agent:delete:own",
  AgentUseAll: "agent:use:all",
  AgentUseOwn: "agent:use:own",

  LlmProviderReadAll: "llm_provider:read:all",
  LlmProviderReadOwn: "llm_provider:read:own",
  LlmProviderListAll: "llm_provider:list:all",
  LlmProviderListOwn: "llm_provider:list:own",
  LlmProviderCreate: "llm_provider:create",
  LlmProviderUpdateAll: "llm_provider:update:all",
  LlmProviderUpdateOwn: "llm_provider:update:own",
  LlmProviderDeleteAll: "llm_provider:delete:all",
  LlmProviderDeleteOwn: "llm_provider:delete:own",
  LlmProviderUseAll: "llm_provider:use:all",
  LlmProviderUseOwn: "llm_provider:use:own",

  McpServerReadAll: "mcp_server:read:all",
  McpServerReadOwn: "mcp_server:read:own",
  McpServerListAll: "mcp_server:list:all",
  McpServerListOwn: "mcp_server:list:own",
  McpServerCreate: "mcp_server:create",
  McpServerUpdateAll: "mcp_server:update:all",
  McpServerUpdateOwn: "mcp_server:update:own",
  McpServerDeleteAll: "mcp_server:delete:all",
  McpServerDeleteOwn: "mcp_server:delete:own",
  McpServerUseAll: "mcp_server:use:all",
  McpServerUseOwn: "mcp_server:use:own",

  SkillReadAll: "skill:read:all",
  SkillReadOwn: "skill:read:own",
  SkillListAll: "skill:list:all",
  SkillListOwn: "skill:list:own",
  SkillCreate: "skill:create",
  SkillUpdateAll: "skill:update:all",
  SkillUpdateOwn: "skill:update:own",
  SkillDeleteAll: "skill:delete:all",
  SkillDeleteOwn: "skill:delete:own",
  SkillUseAll: "skill:use:all",
  SkillUseOwn: "skill:use:own",

  ExecutionReadAll: "execution:read:all",
  ExecutionReadOwn: "execution:read:own",
  ExecutionListAll: "execution:list:all",
  ExecutionListOwn: "execution:list:own",
  ExecutionCancelAll: "execution:cancel:all",
  ExecutionCancelOwn: "execution:cancel:own",
} as const;

export type PermissionName = (typeof Permissions)[keyof typeof Permissions];

export const RolePermissions: Record<RoleName, readonly PermissionName[]> = {
  [Roles.Admin]: [
    Permissions.UserReadAll,
    Permissions.UserListAll,
    Permissions.UserCreate,
    Permissions.UserUpdateAll,
    Permissions.UserDeleteAll,

    Permissions.GroupReadAll,
    Permissions.GroupListAll,
    Permissions.GroupCreate,
    Permissions.GroupUpdateAll,
    Permissions.GroupDeleteAll,

    Permissions.SettingsReadAll,
    Permissions.SettingsListAll,
    Permissions.SettingsCreate,
    Permissions.SettingsUpdateAll,
    Permissions.SettingsDeleteAll,

    Permissions.ChatReadOwn,
    Permissions.ChatListOwn,
    Permissions.ChatCreate,
    Permissions.ChatUpdateOwn,
    Permissions.ChatDeleteOwn,

    Permissions.AgentReadAll,
    Permissions.AgentListAll,
    Permissions.AgentCreate,
    Permissions.AgentUpdateAll,
    Permissions.AgentDeleteAll,
    Permissions.AgentUseAll,

    Permissions.LlmProviderReadAll,
    Permissions.LlmProviderListAll,
    Permissions.LlmProviderCreate,
    Permissions.LlmProviderUpdateAll,
    Permissions.LlmProviderDeleteAll,
    Permissions.LlmProviderUseAll,

    Permissions.McpServerReadAll,
    Permissions.McpServerListAll,
    Permissions.McpServerCreate,
    Permissions.McpServerUpdateAll,
    Permissions.McpServerDeleteAll,
    Permissions.McpServerUseAll,

    Permissions.SkillReadAll,
    Permissions.SkillListAll,
    Permissions.SkillCreate,
    Permissions.SkillUpdateAll,
    Permissions.SkillDeleteAll,
    Permissions.SkillUseAll,

    Permissions.ExecutionReadAll,
    Permissions.ExecutionListAll,
    Permissions.ExecutionCancelAll,
  ],
  [Roles.Auditor]: [
    Permissions.UserReadAll,
    Permissions.UserListAll,

    Permissions.GroupReadAll,
    Permissions.GroupListAll,

    Permissions.SettingsReadAll,
    Permissions.SettingsListAll,

    Permissions.ChatReadOwn,
    Permissions.ChatListOwn,
    Permissions.ChatCreate,
    Permissions.ChatUpdateOwn,
    Permissions.ChatDeleteOwn,

    Permissions.AgentReadAll,
    Permissions.AgentListAll,
    Permissions.AgentCreate,
    Permissions.AgentUpdateOwn,
    Permissions.AgentDeleteOwn,
    Permissions.AgentUseOwn,

    Permissions.LlmProviderReadAll,
    Permissions.LlmProviderListAll,
    Permissions.LlmProviderCreate,
    Permissions.LlmProviderUpdateOwn,
    Permissions.LlmProviderDeleteOwn,
    Permissions.LlmProviderUseOwn,

    Permissions.McpServerReadAll,
    Permissions.McpServerListAll,
    Permissions.McpServerCreate,
    Permissions.McpServerUpdateOwn,
    Permissions.McpServerDeleteOwn,
    Permissions.McpServerUseOwn,

    Permissions.SkillReadAll,
    Permissions.SkillListAll,
    Permissions.SkillCreate,
    Permissions.SkillUpdateOwn,
    Permissions.SkillDeleteOwn,
    Permissions.SkillUseOwn,

    Permissions.ExecutionReadAll,
    Permissions.ExecutionListAll,
    Permissions.ExecutionCancelOwn,
  ],
  [Roles.Creator]: [
    Permissions.UserReadAll,
    Permissions.UserListAll,

    Permissions.GroupReadAll,
    Permissions.GroupListAll,

    Permissions.SettingsReadPublic,
    Permissions.SettingsListPublic,

    Permissions.ChatReadOwn,
    Permissions.ChatListOwn,
    Permissions.ChatCreate,
    Permissions.ChatUpdateOwn,
    Permissions.ChatDeleteOwn,

    Permissions.AgentReadOwn,
    Permissions.AgentListOwn,
    Permissions.AgentCreate,
    Permissions.AgentUpdateOwn,
    Permissions.AgentDeleteOwn,
    Permissions.AgentUseOwn,

    Permissions.LlmProviderReadOwn,
    Permissions.LlmProviderListOwn,
    Permissions.LlmProviderCreate,
    Permissions.LlmProviderUpdateOwn,
    Permissions.LlmProviderDeleteOwn,
    Permissions.LlmProviderUseOwn,

    Permissions.McpServerReadOwn,
    Permissions.McpServerListOwn,
    Permissions.McpServerCreate,
    Permissions.McpServerUpdateOwn,
    Permissions.McpServerDeleteOwn,
    Permissions.McpServerUseOwn,

    Permissions.SkillReadOwn,
    Permissions.SkillListOwn,
    Permissions.SkillCreate,
    Permissions.SkillUpdateOwn,
    Permissions.SkillDeleteOwn,
    Permissions.SkillUseOwn,

    Permissions.ExecutionReadOwn,
    Permissions.ExecutionListOwn,
    Permissions.ExecutionCancelOwn,
  ],
  [Roles.Member]: [
    Permissions.UserReadOwn,

    Permissions.GroupReadOwn,
    Permissions.GroupListOwn,

    Permissions.SettingsReadPublic,
    Permissions.SettingsListPublic,

    Permissions.ChatReadOwn,
    Permissions.ChatListOwn,
    Permissions.ChatCreate,
    Permissions.ChatUpdateOwn,
    Permissions.ChatDeleteOwn,

    Permissions.AgentReadOwn,
    Permissions.AgentListOwn,
    Permissions.AgentUpdateOwn,
    Permissions.AgentDeleteOwn,
    Permissions.AgentUseOwn,

    Permissions.LlmProviderReadOwn,
    Permissions.LlmProviderListOwn,
    Permissions.LlmProviderUpdateOwn,
    Permissions.LlmProviderDeleteOwn,
    Permissions.LlmProviderUseOwn,

    Permissions.McpServerReadOwn,
    Permissions.McpServerListOwn,
    Permissions.McpServerUpdateOwn,
    Permissions.McpServerDeleteOwn,
    Permissions.McpServerUseOwn,

    Permissions.SkillReadOwn,
    Permissions.SkillListOwn,
    Permissions.SkillUpdateOwn,
    Permissions.SkillDeleteOwn,
    Permissions.SkillUseOwn,

    Permissions.ExecutionReadOwn,
    Permissions.ExecutionListOwn,
    Permissions.ExecutionCancelOwn,
  ],
} as const;

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
