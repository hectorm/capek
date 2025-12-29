import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";

import type { HttpHeader } from "~~/shared/http";
import type { MCPTool } from "~~/shared/mcp";
import type { OpenAIFunctionParameters } from "~~/shared/openai";

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

export interface ChatSessionsTable {
  id: ColumnType<string, string | undefined, never>;
  userId: ColumnType<string, string, never>;
  agentId: string | null;
  title: string;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type ChatSession = Selectable<ChatSessionsTable>;
export type NewChatSession = Insertable<ChatSessionsTable>;
export type ChatSessionUpdate = Updateable<ChatSessionsTable>;

////////////////////////////////

export interface ChatMessagesTable {
  id: ColumnType<string, string | undefined, never>;
  sessionId: ColumnType<string, string, never>;
  role: "app" | "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type ChatMessage = Selectable<ChatMessagesTable>;
export type NewChatMessage = Insertable<ChatMessagesTable>;
export type ChatMessageUpdate = Updateable<ChatMessagesTable>;

////////////////////////////////

export interface ChatSessionVfsTable {
  sessionId: ColumnType<string, string, never>;
  data: Buffer;
  updatedAt: ColumnType<Date, Date | undefined, Date>;
}

export type ChatSessionVfs = Selectable<ChatSessionVfsTable>;
export type NewChatSessionVfs = Insertable<ChatSessionVfsTable>;
export type ChatSessionVfsUpdate = Updateable<ChatSessionVfsTable>;

////////////////////////////////

export interface LlmProvidersTable {
  id: ColumnType<string, string | undefined, never>;
  name: string;
  description: string;
  apiUrl: string;
  apiKey: string;
  headers: ColumnType<HttpHeader[], string, string>;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type LlmProvider = Selectable<LlmProvidersTable>;
export type NewLlmProvider = Insertable<LlmProvidersTable>;
export type LlmProviderUpdate = Updateable<LlmProvidersTable>;

////////////////////////////////

export interface LlmProviderAccessTable {
  id: ColumnType<number, never, never>;
  llmProviderId: ColumnType<string, string, never>;
  userId: string | null;
  groupId: string | null;
  role: "editor" | "user";
  createdAt: ColumnType<Date, never, never>;
}

export type LlmProviderAccess = Selectable<LlmProviderAccessTable>;
export type NewLlmProviderAccess = Insertable<LlmProviderAccessTable>;

////////////////////////////////

export interface McpServersTable {
  id: ColumnType<string, string | undefined, never>;
  name: string;
  description: string;
  url: string;
  headers: ColumnType<HttpHeader[], string, string>;
  stateful: boolean;
  toolCallTimeoutSec: number | null;
  cachedTools: ColumnType<MCPTool[], string, string>;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type McpServer = Selectable<McpServersTable>;
export type NewMcpServer = Insertable<McpServersTable>;
export type McpServerUpdate = Updateable<McpServersTable>;

////////////////////////////////

export interface McpServerAccessTable {
  id: ColumnType<number, never, never>;
  mcpServerId: ColumnType<string, string, never>;
  userId: string | null;
  groupId: string | null;
  role: "editor" | "user";
  createdAt: ColumnType<Date, never, never>;
}

export type McpServerAccess = Selectable<McpServerAccessTable>;
export type NewMcpServerAccess = Insertable<McpServerAccessTable>;

////////////////////////////////

export interface SkillsTable {
  id: ColumnType<string, string | undefined, never>;
  name: string;
  description: string;
  documentation: string | null;
  parameters: ColumnType<OpenAIFunctionParameters | null, string | null, string | null>;
  code: string | null;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type Skill = Selectable<SkillsTable>;
export type NewSkill = Insertable<SkillsTable>;
export type SkillUpdate = Updateable<SkillsTable>;

////////////////////////////////

export interface SkillAccessTable {
  id: ColumnType<number, never, never>;
  skillId: ColumnType<string, string, never>;
  userId: string | null;
  groupId: string | null;
  role: "editor" | "user";
  createdAt: ColumnType<Date, never, never>;
}

export type SkillAccess = Selectable<SkillAccessTable>;
export type NewSkillAccess = Insertable<SkillAccessTable>;

////////////////////////////////

export interface AgentsTable {
  id: ColumnType<string, string | undefined, never>;
  name: string;
  description: string;
  instructions: string;
  greetingMessage: string;
  type: "triage" | "specialist";
  llmProviderId: string | null;
  model: string;
  summaryModel: string;
  codeInterpreter: boolean;
  streaming: boolean;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  maxIterations: number | null;
  timeoutSec: number | null;
  maxContextChars: number | null;
  maxToolResponseChars: number | null;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type Agent = Selectable<AgentsTable>;
export type NewAgent = Insertable<AgentsTable>;
export type AgentUpdate = Updateable<AgentsTable>;

////////////////////////////////

export interface AgentAccessTable {
  id: ColumnType<number, never, never>;
  agentId: ColumnType<string, string, never>;
  userId: string | null;
  groupId: string | null;
  role: "editor" | "user";
  createdAt: ColumnType<Date, never, never>;
}

export type AgentAccess = Selectable<AgentAccessTable>;
export type NewAgentAccess = Insertable<AgentAccessTable>;

////////////////////////////////

export interface AgentMcpServersTable {
  agentId: ColumnType<string, string, never>;
  mcpServerId: ColumnType<string, string, never>;
  createdAt: ColumnType<Date, never, never>;
}

export type AgentMcpServer = Selectable<AgentMcpServersTable>;
export type NewAgentMcpServer = Insertable<AgentMcpServersTable>;

////////////////////////////////

export interface AgentSkillsTable {
  agentId: ColumnType<string, string, never>;
  skillId: ColumnType<string, string, never>;
  createdAt: ColumnType<Date, never, never>;
}

export type AgentSkill = Selectable<AgentSkillsTable>;
export type NewAgentSkill = Insertable<AgentSkillsTable>;

////////////////////////////////

export interface TriageSpecialistsTable {
  triageAgentId: ColumnType<string, string, never>;
  specialistAgentId: ColumnType<string, string, never>;
  createdAt: ColumnType<Date, never, never>;
}

export type TriageSpecialist = Selectable<TriageSpecialistsTable>;
export type NewTriageSpecialist = Insertable<TriageSpecialistsTable>;

////////////////////////////////

export interface AgentExecutionsTable {
  id: ColumnType<string, string | undefined, never>;
  sessionId: ColumnType<string, string, never>;
  agentId: ColumnType<string, string, never>;
  userId: string | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  inputMessageId: string | null;
  outputMessageId: string | null;
  startedAt: Date | null;
  lastActivityAt: ColumnType<Date, Date, Date>;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: ColumnType<Date, never, never>;
}

export type AgentExecution = Selectable<AgentExecutionsTable>;
export type NewAgentExecution = Insertable<AgentExecutionsTable>;
export type AgentExecutionUpdate = Updateable<AgentExecutionsTable>;

////////////////////////////////

export interface AgentCodeExecutionsTable {
  id: ColumnType<string, string | undefined, never>;
  executionId: string | null;
  code: string;
  reasoning: string | null;
  result: ColumnType<unknown, string | null, string | null>;
  logs: ColumnType<unknown, string | null, string | null>;
  errorMessage: string | null;
  executionMs: number;
  createdAt: ColumnType<Date, never, never>;
}

export type AgentCodeExecution = Selectable<AgentCodeExecutionsTable>;
export type NewAgentCodeExecution = Insertable<AgentCodeExecutionsTable>;
export type AgentCodeExecutionUpdate = Updateable<AgentCodeExecutionsTable>;

////////////////////////////////

export interface AgentToolCallsTable {
  id: ColumnType<string, string | undefined, never>;
  executionId: ColumnType<string, string, never>;
  mcpServerId: string | null;
  skillId: string | null;
  codeExecutionId: string | null;
  toolName: string;
  arguments: string;
  result: string | null;
  errorMessage: string | null;
  createdAt: ColumnType<Date, never, never>;
  completedAt: Date | null;
}

export type AgentToolCall = Selectable<AgentToolCallsTable>;
export type NewAgentToolCall = Insertable<AgentToolCallsTable>;
export type AgentToolCallUpdate = Updateable<AgentToolCallsTable>;

////////////////////////////////

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
  chatSessions: ChatSessionsTable;
  chatMessages: ChatMessagesTable;
  chatSessionVfs: ChatSessionVfsTable;
  llmProviders: LlmProvidersTable;
  llmProviderAccess: LlmProviderAccessTable;
  mcpServers: McpServersTable;
  mcpServerAccess: McpServerAccessTable;
  skills: SkillsTable;
  skillAccess: SkillAccessTable;
  agents: AgentsTable;
  agentAccess: AgentAccessTable;
  agentMcpServers: AgentMcpServersTable;
  agentSkills: AgentSkillsTable;
  triageSpecialists: TriageSpecialistsTable;
  agentExecutions: AgentExecutionsTable;
  agentCodeExecutions: AgentCodeExecutionsTable;
  agentToolCalls: AgentToolCallsTable;
}
