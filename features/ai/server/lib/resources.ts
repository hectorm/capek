import { defineSharedResource } from "#layers/core/server/lib/authz/resources";
import { defineOwnedResource } from "#layers/core/server/lib/database/security";

export const AgentResource = defineSharedResource({ type: "ai_agent", table: "ai_agents", foreignKey: "agent_id" });

export const LlmProviderResource = defineSharedResource({
  type: "ai_llm_provider",
  table: "ai_llm_providers",
  foreignKey: "llm_provider_id",
});

export const McpServerResource = defineSharedResource({
  type: "ai_mcp_server",
  table: "ai_mcp_servers",
  foreignKey: "mcp_server_id",
});

export const SkillResource = defineSharedResource({ type: "ai_skill", table: "ai_skills", foreignKey: "skill_id" });

export const ChatResource = defineOwnedResource({ type: "ai_chat", table: "ai_chat_sessions" });

export const AgentExecutionResource = defineOwnedResource({ type: "ai_agent_execution", table: "ai_agent_executions" });
