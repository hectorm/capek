import type { SecurityDefinition } from "#layers/core/server/lib/database/security";
import {
  AgentExecutionResource,
  AgentResource,
  ChatResource,
  LlmProviderResource,
  McpServerResource,
  SkillResource,
} from "#layers/ai/server/lib/resources";
import { hasAccess, isOwner, protectTable, sharedResourcePolicies } from "#layers/core/server/lib/database/security";

export const aiSecurity: SecurityDefinition = {
  ownedResources: [ChatResource, AgentExecutionResource],
  sharedResources: [AgentResource, LlmProviderResource, McpServerResource, SkillResource],
  statements: () => [
    // Function to check whether an agent already links to a resource, which gives no access to it from other agents
    `
      CREATE FUNCTION security.ai_agent_has_linked_resource(agent_id UUID, resource_type TEXT, resource_id UUID)
      RETURNS BOOLEAN
      LANGUAGE SQL
      STABLE
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT CASE resource_type
            WHEN 'ai_llm_provider' THEN EXISTS (
              SELECT 1 FROM public.ai_agents
              WHERE ai_agents.id = agent_id
                AND ai_agents.llm_provider_id = resource_id
            )
            ELSE FALSE
          END;
      $$;
    `,

    // Chat Sessions
    ...protectTable("ai_chat_sessions"),
    `
      CREATE POLICY ai_chat_sessions_select ON public.ai_chat_sessions
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['ai_chat:read:all', 'ai_chat:list:all']))
          OR (user_id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['ai_chat:read:own', 'ai_chat:list:own'])))
        );
    `,
    `
      CREATE POLICY ai_chat_sessions_insert ON public.ai_chat_sessions
        FOR INSERT
        WITH CHECK (
          user_id = (SELECT security.user_id())
          AND (SELECT security.can_any(ARRAY['ai_chat:create']))
          -- Requires use permission on the agent being attached
          AND (
            agent_id IS NULL
            OR (SELECT security.can_any(ARRAY['ai_agent:use:all']))
            OR (
              (SELECT security.can_any(ARRAY['ai_agent:use:own']))
              AND ${hasAccess(AgentResource, "ai_chat_sessions.agent_id")}
            )
          )
        );
    `,
    `
      CREATE POLICY ai_chat_sessions_update ON public.ai_chat_sessions
        FOR UPDATE
        USING (
          (SELECT security.can_any(ARRAY['ai_chat:update:all']))
          OR (user_id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['ai_chat:update:own'])))
        )
        WITH CHECK (
          (
            (SELECT security.can_any(ARRAY['ai_chat:update:all']))
            OR (user_id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['ai_chat:update:own'])))
          )
          -- Requires use permission on the agent being attached
          AND (
            agent_id IS NULL
            OR (SELECT security.can_any(ARRAY['ai_agent:use:all']))
            OR (
              (SELECT security.can_any(ARRAY['ai_agent:use:own']))
              AND ${hasAccess(AgentResource, "ai_chat_sessions.agent_id")}
            )
          )
        );
    `,
    `
      CREATE POLICY ai_chat_sessions_delete ON public.ai_chat_sessions
        FOR DELETE
        USING (
          (SELECT security.can_any(ARRAY['ai_chat:delete:all']))
          OR (user_id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['ai_chat:delete:own'])))
        );
    `,

    // Chat Messages
    ...protectTable("ai_chat_messages"),
    `
      CREATE POLICY ai_chat_messages_select ON public.ai_chat_messages
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['ai_chat:read:all', 'ai_chat:list:all']))
          OR ((SELECT security.can_any(ARRAY['ai_chat:read:own', 'ai_chat:list:own'])) AND ${isOwner(ChatResource, "ai_chat_messages.session_id")})
        );
    `,
    `
      CREATE POLICY ai_chat_messages_insert ON public.ai_chat_messages
        FOR INSERT
        WITH CHECK (
          (SELECT security.can_any(ARRAY['ai_chat:create']))
          AND ${isOwner(ChatResource, "ai_chat_messages.session_id")}
          -- Users author only 'user' turns, server-authored roles need a trusted-write transaction
          AND (role = 'user' OR (role IN ('assistant', 'app', 'system', 'tool') AND (SELECT security.is_trusted_write())))
        );
    `,
    `
      CREATE POLICY ai_chat_messages_update ON public.ai_chat_messages
        FOR UPDATE
        USING (
          (SELECT security.can_any(ARRAY['ai_chat:update:all']))
          -- Users can only update their own 'user' role messages (not AI responses)
          OR ((SELECT security.can_any(ARRAY['ai_chat:update:own'])) AND role = 'user' AND ${isOwner(ChatResource, "ai_chat_messages.session_id")})
        )
        WITH CHECK (
          (SELECT security.can_any(ARRAY['ai_chat:update:all']))
          OR ((SELECT security.can_any(ARRAY['ai_chat:update:own'])) AND role = 'user' AND ${isOwner(ChatResource, "ai_chat_messages.session_id")})
        );
    `,
    `
      CREATE POLICY ai_chat_messages_delete ON public.ai_chat_messages
        FOR DELETE
        USING (
          (SELECT security.can_any(ARRAY['ai_chat:delete:all']))
          OR ((SELECT security.can_any(ARRAY['ai_chat:delete:own'])) AND ${isOwner(ChatResource, "ai_chat_messages.session_id")})
        );
    `,

    // Chat Session VFS
    ...protectTable("ai_chat_session_vfs"),
    `
      CREATE POLICY ai_chat_session_vfs_select ON public.ai_chat_session_vfs
        FOR SELECT
        USING (${isOwner(ChatResource, "ai_chat_session_vfs.session_id")});
    `,
    `
      CREATE POLICY ai_chat_session_vfs_insert ON public.ai_chat_session_vfs
        FOR INSERT
        WITH CHECK (${isOwner(ChatResource, "ai_chat_session_vfs.session_id")});
    `,
    `
      CREATE POLICY ai_chat_session_vfs_update ON public.ai_chat_session_vfs
        FOR UPDATE
        USING (${isOwner(ChatResource, "ai_chat_session_vfs.session_id")})
        WITH CHECK (${isOwner(ChatResource, "ai_chat_session_vfs.session_id")});
    `,
    `
      CREATE POLICY ai_chat_session_vfs_delete ON public.ai_chat_session_vfs
        FOR DELETE
        USING (${isOwner(ChatResource, "ai_chat_session_vfs.session_id")});
    `,

    // LLM Providers
    ...sharedResourcePolicies(LlmProviderResource),

    // MCP Servers
    ...sharedResourcePolicies(McpServerResource),

    // Skills
    ...sharedResourcePolicies(SkillResource),

    // Agents
    ...sharedResourcePolicies(AgentResource, {
      // Requires use permission on the LLM provider being assigned
      insertCheck: `
        llm_provider_id IS NULL
        OR (SELECT security.can_any(ARRAY['ai_llm_provider:use:all']))
        OR (
          (SELECT security.can_any(ARRAY['ai_llm_provider:use:own']))
          AND ${hasAccess(LlmProviderResource, "ai_agents.llm_provider_id")}
        )
      `,
      // Requires use permission on the LLM provider being assigned
      updateCheck: `
        llm_provider_id IS NULL
        OR (SELECT security.can_any(ARRAY['ai_llm_provider:use:all']))
        OR (
          (SELECT security.can_any(ARRAY['ai_llm_provider:use:own']))
          AND (
            ${hasAccess(LlmProviderResource, "ai_agents.llm_provider_id")}
            OR security.ai_agent_has_linked_resource(id, 'ai_llm_provider', llm_provider_id)
          )
        )
      `,
    }),

    // Agent MCP Servers
    ...protectTable("ai_agent_mcp_servers"),
    `
      CREATE POLICY ai_agent_mcp_servers_select ON public.ai_agent_mcp_servers
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['ai_agent:read:all', 'ai_agent:update:all', 'ai_agent:use:all']))
          OR (
            (SELECT security.can_any(ARRAY['ai_agent:read:own', 'ai_agent:update:own', 'ai_agent:use:own']))
            AND ${hasAccess(AgentResource, "ai_agent_mcp_servers.agent_id")}
          )
        );
    `,
    `
      CREATE POLICY ai_agent_mcp_servers_insert ON public.ai_agent_mcp_servers
        FOR INSERT
        WITH CHECK (
          -- Requires update permission on the agent
          (
            (SELECT security.can_any(ARRAY['ai_agent:update:all']))
            OR ((SELECT security.can_any(ARRAY['ai_agent:update:own'])) AND ${hasAccess(AgentResource, "ai_agent_mcp_servers.agent_id", ["editor"])})
          )
          -- Requires use permission on the MCP server being assigned
          AND (
            (SELECT security.can_any(ARRAY['ai_mcp_server:use:all']))
            OR ((SELECT security.can_any(ARRAY['ai_mcp_server:use:own'])) AND ${hasAccess(McpServerResource, "ai_agent_mcp_servers.mcp_server_id")})
          )
        );
    `,
    `
      CREATE POLICY ai_agent_mcp_servers_delete ON public.ai_agent_mcp_servers
        FOR DELETE
        USING (
          (SELECT security.can_any(ARRAY['ai_agent:update:all']))
          OR ((SELECT security.can_any(ARRAY['ai_agent:update:own'])) AND ${hasAccess(AgentResource, "ai_agent_mcp_servers.agent_id", ["editor"])})
        );
    `,

    // Agent Skills
    ...protectTable("ai_agent_skills"),
    `
      CREATE POLICY ai_agent_skills_select ON public.ai_agent_skills
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['ai_agent:read:all', 'ai_agent:update:all', 'ai_agent:use:all']))
          OR (
            (SELECT security.can_any(ARRAY['ai_agent:read:own', 'ai_agent:update:own', 'ai_agent:use:own']))
            AND ${hasAccess(AgentResource, "ai_agent_skills.agent_id")}
          )
        );
    `,
    `
      CREATE POLICY ai_agent_skills_insert ON public.ai_agent_skills
        FOR INSERT
        WITH CHECK (
          -- Requires update permission on the agent
          (
            (SELECT security.can_any(ARRAY['ai_agent:update:all']))
            OR ((SELECT security.can_any(ARRAY['ai_agent:update:own'])) AND ${hasAccess(AgentResource, "ai_agent_skills.agent_id", ["editor"])})
          )
          -- Requires use permission on the skill being assigned
          AND (
            (SELECT security.can_any(ARRAY['ai_skill:use:all']))
            OR ((SELECT security.can_any(ARRAY['ai_skill:use:own'])) AND ${hasAccess(SkillResource, "ai_agent_skills.skill_id")})
          )
        );
    `,
    `
      CREATE POLICY ai_agent_skills_delete ON public.ai_agent_skills
        FOR DELETE
        USING (
          (SELECT security.can_any(ARRAY['ai_agent:update:all']))
          OR ((SELECT security.can_any(ARRAY['ai_agent:update:own'])) AND ${hasAccess(AgentResource, "ai_agent_skills.agent_id", ["editor"])})
        );
    `,

    // Agent Tool Resources
    ...protectTable("ai_agent_tool_resources"),
    `
      CREATE POLICY ai_agent_tool_resources_select ON public.ai_agent_tool_resources
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['ai_agent:read:all', 'ai_agent:update:all', 'ai_agent:use:all']))
          OR (
            (SELECT security.can_any(ARRAY['ai_agent:read:own', 'ai_agent:update:own', 'ai_agent:use:own']))
            AND ${hasAccess(AgentResource, "ai_agent_tool_resources.agent_id")}
          )
        );
    `,
    `
      CREATE POLICY ai_agent_tool_resources_insert ON public.ai_agent_tool_resources
        FOR INSERT
        WITH CHECK (
          -- Requires update permission on the agent
          (
            (SELECT security.can_any(ARRAY['ai_agent:update:all']))
            OR ((SELECT security.can_any(ARRAY['ai_agent:update:own'])) AND ${hasAccess(AgentResource, "ai_agent_tool_resources.agent_id", ["editor"])})
          )
          -- Requires use permission on the resource being assigned
          AND (
            (SELECT security.can_any(ARRAY[resource_type || ':use:all']))
            OR ((SELECT security.can_any(ARRAY[resource_type || ':use:own'])) AND security.has_access(resource_type, resource_id))
          )
        );
    `,
    `
      CREATE POLICY ai_agent_tool_resources_delete ON public.ai_agent_tool_resources
        FOR DELETE
        USING (
          (SELECT security.can_any(ARRAY['ai_agent:update:all']))
          OR ((SELECT security.can_any(ARRAY['ai_agent:update:own'])) AND ${hasAccess(AgentResource, "ai_agent_tool_resources.agent_id", ["editor"])})
        );
    `,

    // Triage Specialists
    ...protectTable("ai_triage_specialists"),
    `
      CREATE POLICY ai_triage_specialists_select ON public.ai_triage_specialists
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['ai_agent:read:all', 'ai_agent:update:all', 'ai_agent:use:all']))
          OR (
            (SELECT security.can_any(ARRAY['ai_agent:read:own', 'ai_agent:update:own', 'ai_agent:use:own']))
            AND ${hasAccess(AgentResource, "ai_triage_specialists.triage_agent_id")}
          )
        );
    `,
    `
      CREATE POLICY ai_triage_specialists_insert ON public.ai_triage_specialists
        FOR INSERT
        WITH CHECK (
          -- Requires update permission on the triage agent
          (
            (SELECT security.can_any(ARRAY['ai_agent:update:all']))
            OR ((SELECT security.can_any(ARRAY['ai_agent:update:own'])) AND ${hasAccess(AgentResource, "ai_triage_specialists.triage_agent_id", ["editor"])})
          )
          -- Requires use permission on the specialist agent being assigned
          AND (
            (SELECT security.can_any(ARRAY['ai_agent:use:all']))
            OR ((SELECT security.can_any(ARRAY['ai_agent:use:own'])) AND ${hasAccess(AgentResource, "ai_triage_specialists.specialist_agent_id")})
          )
        );
    `,
    `
      CREATE POLICY ai_triage_specialists_delete ON public.ai_triage_specialists
        FOR DELETE
        USING (
          (SELECT security.can_any(ARRAY['ai_agent:update:all']))
          OR ((SELECT security.can_any(ARRAY['ai_agent:update:own'])) AND ${hasAccess(AgentResource, "ai_triage_specialists.triage_agent_id", ["editor"])})
        );
    `,

    // Agent Executions
    ...protectTable("ai_agent_executions"),
    `
      CREATE POLICY ai_agent_executions_select ON public.ai_agent_executions
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['ai_agent_execution:read:all', 'ai_agent_execution:list:all']))
          OR (user_id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['ai_agent_execution:read:own', 'ai_agent_execution:list:own'])))
        );
    `,
    `
      CREATE POLICY ai_agent_executions_insert ON public.ai_agent_executions
        FOR INSERT
        WITH CHECK (
          user_id = (SELECT security.user_id())
          AND (SELECT security.can_any(ARRAY['ai_chat:create']))
          -- Requires use permission on the agent being executed
          AND (
            (SELECT security.can_any(ARRAY['ai_agent:use:all']))
            OR (
              (SELECT security.can_any(ARRAY['ai_agent:use:own']))
              AND ${hasAccess(AgentResource, "ai_agent_executions.agent_id")}
            )
          )
          -- Requires ownership of the chat session
          AND (session_id IS NULL OR ${isOwner(ChatResource, "ai_agent_executions.session_id")})
        );
    `,
    `
      CREATE POLICY ai_agent_executions_update ON public.ai_agent_executions
        FOR UPDATE
        USING (
          (SELECT security.can_any(ARRAY['ai_agent_execution:cancel:all']))
          OR (user_id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['ai_agent_execution:cancel:own'])))
        )
        WITH CHECK (
          (SELECT security.can_any(ARRAY['ai_agent_execution:cancel:all']))
          OR (user_id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['ai_agent_execution:cancel:own'])))
        );
    `,

    // Agent Code Executions
    ...protectTable("ai_agent_code_executions"),
    `
      CREATE POLICY ai_agent_code_executions_select ON public.ai_agent_code_executions
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['ai_agent_execution:list:all', 'ai_agent_execution:read:all']))
          OR ((SELECT security.can_any(ARRAY['ai_agent_execution:list:own', 'ai_agent_execution:read:own'])) AND ${isOwner(AgentExecutionResource, "ai_agent_code_executions.execution_id")})
        );
    `,
    `
      CREATE POLICY ai_agent_code_executions_insert ON public.ai_agent_code_executions
        FOR INSERT
        WITH CHECK (
          (SELECT security.can_any(ARRAY['ai_chat:create'])) AND ${isOwner(AgentExecutionResource, "ai_agent_code_executions.execution_id")}
        );
    `,
    `
      CREATE POLICY ai_agent_code_executions_update ON public.ai_agent_code_executions
        FOR UPDATE
        USING (
          (SELECT security.can_any(ARRAY['ai_chat:update:own'])) AND ${isOwner(AgentExecutionResource, "ai_agent_code_executions.execution_id")}
        )
        WITH CHECK (
          (SELECT security.can_any(ARRAY['ai_chat:update:own'])) AND ${isOwner(AgentExecutionResource, "ai_agent_code_executions.execution_id")}
        );
    `,

    // Agent Tool Calls
    ...protectTable("ai_agent_tool_calls"),
    `
      CREATE POLICY ai_agent_tool_calls_select ON public.ai_agent_tool_calls
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['ai_agent_execution:list:all', 'ai_agent_execution:read:all']))
          OR ((SELECT security.can_any(ARRAY['ai_agent_execution:list:own', 'ai_agent_execution:read:own'])) AND ${isOwner(AgentExecutionResource, "ai_agent_tool_calls.execution_id")})
        );
    `,
    `
      CREATE POLICY ai_agent_tool_calls_insert ON public.ai_agent_tool_calls
        FOR INSERT
        WITH CHECK (
          (SELECT security.can_any(ARRAY['ai_chat:create'])) AND ${isOwner(AgentExecutionResource, "ai_agent_tool_calls.execution_id")}
        );
    `,
    `
      CREATE POLICY ai_agent_tool_calls_update ON public.ai_agent_tool_calls
        FOR UPDATE
        USING (
          (SELECT security.can_any(ARRAY['ai_chat:update:own'])) AND ${isOwner(AgentExecutionResource, "ai_agent_tool_calls.execution_id")}
        )
        WITH CHECK (
          (SELECT security.can_any(ARRAY['ai_chat:update:own'])) AND ${isOwner(AgentExecutionResource, "ai_agent_tool_calls.execution_id")}
        );
    `,
  ],
};
