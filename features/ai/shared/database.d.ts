import type {
  AgentAccessTable,
  AgentCodeExecutionsTable,
  AgentExecutionsTable,
  AgentMcpServersTable,
  AgentSkillsTable,
  AgentsTable,
  AgentToolCallsTable,
  AgentToolResourcesTable,
  ChatMessagesTable,
  ChatSessionsTable,
  ChatSessionVfsTable,
  LlmProviderAccessTable,
  LlmProvidersTable,
  McpServerAccessTable,
  McpServersTable,
  SkillAccessTable,
  SkillsTable,
  TriageSpecialistsTable,
} from "#layers/ai/shared/schema";

declare module "#layers/core/shared/schema" {
  interface Database {
    aiChatSessions: ChatSessionsTable;
    aiChatMessages: ChatMessagesTable;
    aiChatSessionVfs: ChatSessionVfsTable;
    aiLlmProviders: LlmProvidersTable;
    aiLlmProviderAccess: LlmProviderAccessTable;
    aiMcpServers: McpServersTable;
    aiMcpServerAccess: McpServerAccessTable;
    aiSkills: SkillsTable;
    aiSkillAccess: SkillAccessTable;
    aiAgents: AgentsTable;
    aiAgentAccess: AgentAccessTable;
    aiAgentMcpServers: AgentMcpServersTable;
    aiAgentSkills: AgentSkillsTable;
    aiAgentToolResources: AgentToolResourcesTable;
    aiTriageSpecialists: TriageSpecialistsTable;
    aiAgentExecutions: AgentExecutionsTable;
    aiAgentCodeExecutions: AgentCodeExecutionsTable;
    aiAgentToolCalls: AgentToolCallsTable;
  }
}
