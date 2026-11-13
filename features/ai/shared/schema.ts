import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";

import type { LlmItem } from "#layers/ai/shared/llm";
import type { LlmProviderApiType } from "#layers/ai/shared/llmProvider";
import type { MCPTool } from "#layers/ai/shared/mcp";
import type { OpenAIFunctionParameters } from "#layers/ai/shared/openai";
import type { ResourceAccessTable } from "#layers/core/shared/schema";

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
  items: ColumnType<LlmItem[], string | undefined, string>;
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

export interface ChatTablesTable {
  id: ColumnType<string, string | undefined, never>;
  sessionId: ColumnType<string, string, never>;
  messageId: string | null;
  data: Buffer;
  size: number;
  createdAt: ColumnType<Date, never, never>;
}

export type ChatTable = Selectable<ChatTablesTable>;
export type NewChatTable = Insertable<ChatTablesTable>;
export type ChatTableUpdate = Updateable<ChatTablesTable>;

////////////////////////////////

export interface LlmProvidersTable {
  id: ColumnType<string, string | undefined, never>;
  name: string;
  description: string;
  apiUrl: string;
  apiType: LlmProviderApiType;
  apiKey: string;
  headers: string;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type LlmProvider = Selectable<LlmProvidersTable>;
export type NewLlmProvider = Insertable<LlmProvidersTable>;
export type LlmProviderUpdate = Updateable<LlmProvidersTable>;

////////////////////////////////

export type LlmProviderAccessTable = ResourceAccessTable<"llmProviderId">;

export type LlmProviderAccess = Selectable<LlmProviderAccessTable>;
export type NewLlmProviderAccess = Insertable<LlmProviderAccessTable>;

////////////////////////////////

export interface McpServersTable {
  id: ColumnType<string, string | undefined, never>;
  name: string;
  description: string;
  url: string;
  headers: string;
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

export type McpServerAccessTable = ResourceAccessTable<"mcpServerId">;

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

export type SkillAccessTable = ResourceAccessTable<"skillId">;

export type SkillAccess = Selectable<SkillAccessTable>;
export type NewSkillAccess = Insertable<SkillAccessTable>;

////////////////////////////////

export interface AgentsTable {
  id: ColumnType<string, string | undefined, never>;
  name: string;
  description: string;
  instructions: string;
  greetingMessage: string;
  priority: number;
  type: "triage" | "specialist";
  llmProviderId: string | null;
  model: string;
  summaryModel: string;
  reasoningEffort: string;
  codeInterpreter: boolean;
  showToolCalls: boolean;
  toolProviders: ColumnType<string[], string[] | undefined, string[]>;
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
  maxToolPartsChars: number | null;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type Agent = Selectable<AgentsTable>;
export type NewAgent = Insertable<AgentsTable>;
export type AgentUpdate = Updateable<AgentsTable>;

////////////////////////////////

export type AgentAccessTable = ResourceAccessTable<"agentId">;

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

export interface AgentToolResourcesTable {
  agentId: ColumnType<string, string, never>;
  resourceType: ColumnType<string, string, never>;
  resourceId: ColumnType<string, string, never>;
  createdAt: ColumnType<Date, never, never>;
}

export type AgentToolResource = Selectable<AgentToolResourcesTable>;
export type NewAgentToolResource = Insertable<AgentToolResourcesTable>;

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
  toolProvider: string | null;
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
