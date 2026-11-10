import type { SecurityDefinition } from "#layers/core/server/lib/database/security";
import { AgentResource, LlmProviderResource, McpServerResource, SkillResource } from "#layers/ai/server/lib/resources";
import { defineOwnedResource, protectTable, sharedResourcePolicies } from "#layers/core/server/lib/database/security";

export const aiSecurity: SecurityDefinition = {
  ownedResources: [
    defineOwnedResource({ type: "ai_chat", table: "ai_chat_sessions" }),
    defineOwnedResource({ type: "ai_agent_execution", table: "ai_agent_executions" }),
  ],
  sharedResources: [AgentResource, LlmProviderResource, McpServerResource, SkillResource],
  statements: () => [
    // Function to check whether a specific agent already links to a specific resource.
    // This is used for context-scoped access checks that should not become reusable access across agents.
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
          security.can_any(ARRAY['ai_chat:read:all', 'ai_chat:list:all'])
          OR (user_id = security.user_id() AND security.can_any(ARRAY['ai_chat:read:own', 'ai_chat:list:own']))
        );
    `,
    `
      CREATE POLICY ai_chat_sessions_insert ON public.ai_chat_sessions
        FOR INSERT
        WITH CHECK (
          user_id = security.user_id()
          AND security.can_any(ARRAY['ai_chat:create'])
          -- Requires use permission on the agent being attached
          AND (
            agent_id IS NULL
            OR security.can_any(ARRAY['ai_agent:use:all'])
            OR (
              security.can_any(ARRAY['ai_agent:use:own'])
              AND security.has_access('ai_agent', agent_id)
            )
          )
        );
    `,
    `
      CREATE POLICY ai_chat_sessions_update ON public.ai_chat_sessions
        FOR UPDATE
        USING (
          security.can_any(ARRAY['ai_chat:update:all'])
          OR (user_id = security.user_id() AND security.can_any(ARRAY['ai_chat:update:own']))
        )
        WITH CHECK (
          (
            security.can_any(ARRAY['ai_chat:update:all'])
            OR (user_id = security.user_id() AND security.can_any(ARRAY['ai_chat:update:own']))
          )
          -- Requires use permission on the agent being attached
          AND (
            agent_id IS NULL
            OR security.can_any(ARRAY['ai_agent:use:all'])
            OR (
              security.can_any(ARRAY['ai_agent:use:own'])
              AND security.has_access('ai_agent', agent_id)
            )
          )
        );
    `,
    `
      CREATE POLICY ai_chat_sessions_delete ON public.ai_chat_sessions
        FOR DELETE
        USING (
          security.can_any(ARRAY['ai_chat:delete:all'])
          OR (user_id = security.user_id() AND security.can_any(ARRAY['ai_chat:delete:own']))
        );
    `,

    // Chat Messages
    ...protectTable("ai_chat_messages"),
    `
      CREATE POLICY ai_chat_messages_select ON public.ai_chat_messages
        FOR SELECT
        USING (
          security.can_any(ARRAY['ai_chat:read:all', 'ai_chat:list:all'])
          OR (security.can_any(ARRAY['ai_chat:read:own', 'ai_chat:list:own']) AND security.is_owner('ai_chat', session_id))
        );
    `,
    `
      CREATE POLICY ai_chat_messages_insert ON public.ai_chat_messages
        FOR INSERT
        WITH CHECK (
          security.can_any(ARRAY['ai_chat:create']) AND security.is_owner('ai_chat', session_id)
        );
    `,
    `
      CREATE POLICY ai_chat_messages_update ON public.ai_chat_messages
        FOR UPDATE
        USING (
          security.can_any(ARRAY['ai_chat:update:all'])
          -- Users can only update their own 'user' role messages (not AI responses)
          OR (security.can_any(ARRAY['ai_chat:update:own']) AND role = 'user' AND security.is_owner('ai_chat', session_id))
        )
        WITH CHECK (
          security.can_any(ARRAY['ai_chat:update:all'])
          OR (security.can_any(ARRAY['ai_chat:update:own']) AND role = 'user' AND security.is_owner('ai_chat', session_id))
        );
    `,
    `
      CREATE POLICY ai_chat_messages_delete ON public.ai_chat_messages
        FOR DELETE
        USING (
          security.can_any(ARRAY['ai_chat:delete:all'])
          OR (security.can_any(ARRAY['ai_chat:delete:own']) AND security.is_owner('ai_chat', session_id))
        );
    `,

    // Chat Session VFS
    ...protectTable("ai_chat_session_vfs"),
    `
      CREATE POLICY ai_chat_session_vfs_select ON public.ai_chat_session_vfs
        FOR SELECT
        USING (security.is_owner('ai_chat', session_id));
    `,
    `
      CREATE POLICY ai_chat_session_vfs_insert ON public.ai_chat_session_vfs
        FOR INSERT
        WITH CHECK (security.is_owner('ai_chat', session_id));
    `,
    `
      CREATE POLICY ai_chat_session_vfs_update ON public.ai_chat_session_vfs
        FOR UPDATE
        USING (security.is_owner('ai_chat', session_id))
        WITH CHECK (security.is_owner('ai_chat', session_id));
    `,
    `
      CREATE POLICY ai_chat_session_vfs_delete ON public.ai_chat_session_vfs
        FOR DELETE
        USING (security.is_owner('ai_chat', session_id));
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
        OR security.can_any(ARRAY['ai_llm_provider:use:all'])
        OR (
          security.can_any(ARRAY['ai_llm_provider:use:own'])
          AND security.has_access('ai_llm_provider', llm_provider_id)
        )
      `,
      // Requires use permission on the LLM provider being assigned
      updateCheck: `
        llm_provider_id IS NULL
        OR security.can_any(ARRAY['ai_llm_provider:use:all'])
        OR (
          security.can_any(ARRAY['ai_llm_provider:use:own'])
          AND (
            security.has_access('ai_llm_provider', llm_provider_id)
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
          security.can_any(ARRAY['ai_agent:read:all', 'ai_agent:update:all', 'ai_agent:use:all'])
          OR (
            security.can_any(ARRAY['ai_agent:read:own', 'ai_agent:update:own', 'ai_agent:use:own'])
            AND security.has_access('ai_agent', agent_id)
          )
        );
    `,
    `
      CREATE POLICY ai_agent_mcp_servers_insert ON public.ai_agent_mcp_servers
        FOR INSERT
        WITH CHECK (
          -- Requires update permission on the agent
          (
            security.can_any(ARRAY['ai_agent:update:all'])
            OR (security.can_any(ARRAY['ai_agent:update:own']) AND security.has_access('ai_agent', agent_id, ARRAY['editor']))
          )
          -- Requires use permission on the MCP server being assigned
          AND (
            security.can_any(ARRAY['ai_mcp_server:use:all'])
            OR (security.can_any(ARRAY['ai_mcp_server:use:own']) AND security.has_access('ai_mcp_server', mcp_server_id))
          )
        );
    `,
    `
      CREATE POLICY ai_agent_mcp_servers_delete ON public.ai_agent_mcp_servers
        FOR DELETE
        USING (
          security.can_any(ARRAY['ai_agent:update:all'])
          OR (security.can_any(ARRAY['ai_agent:update:own']) AND security.has_access('ai_agent', agent_id, ARRAY['editor']))
        );
    `,

    // Agent Skills
    ...protectTable("ai_agent_skills"),
    `
      CREATE POLICY ai_agent_skills_select ON public.ai_agent_skills
        FOR SELECT
        USING (
          security.can_any(ARRAY['ai_agent:read:all', 'ai_agent:update:all', 'ai_agent:use:all'])
          OR (
            security.can_any(ARRAY['ai_agent:read:own', 'ai_agent:update:own', 'ai_agent:use:own'])
            AND security.has_access('ai_agent', agent_id)
          )
        );
    `,
    `
      CREATE POLICY ai_agent_skills_insert ON public.ai_agent_skills
        FOR INSERT
        WITH CHECK (
          -- Requires update permission on the agent
          (
            security.can_any(ARRAY['ai_agent:update:all'])
            OR (security.can_any(ARRAY['ai_agent:update:own']) AND security.has_access('ai_agent', agent_id, ARRAY['editor']))
          )
          -- Requires use permission on the skill being assigned
          AND (
            security.can_any(ARRAY['ai_skill:use:all'])
            OR (security.can_any(ARRAY['ai_skill:use:own']) AND security.has_access('ai_skill', skill_id))
          )
        );
    `,
    `
      CREATE POLICY ai_agent_skills_delete ON public.ai_agent_skills
        FOR DELETE
        USING (
          security.can_any(ARRAY['ai_agent:update:all'])
          OR (security.can_any(ARRAY['ai_agent:update:own']) AND security.has_access('ai_agent', agent_id, ARRAY['editor']))
        );
    `,

    // Agent Tool Resources
    ...protectTable("ai_agent_tool_resources"),
    `
      CREATE POLICY ai_agent_tool_resources_select ON public.ai_agent_tool_resources
        FOR SELECT
        USING (
          security.can_any(ARRAY['ai_agent:read:all', 'ai_agent:update:all', 'ai_agent:use:all'])
          OR (
            security.can_any(ARRAY['ai_agent:read:own', 'ai_agent:update:own', 'ai_agent:use:own'])
            AND security.has_access('ai_agent', agent_id)
          )
        );
    `,
    `
      CREATE POLICY ai_agent_tool_resources_insert ON public.ai_agent_tool_resources
        FOR INSERT
        WITH CHECK (
          -- Requires update permission on the agent
          (
            security.can_any(ARRAY['ai_agent:update:all'])
            OR (security.can_any(ARRAY['ai_agent:update:own']) AND security.has_access('ai_agent', agent_id, ARRAY['editor']))
          )
          -- Requires use permission on the resource being assigned
          AND (
            security.can_any(ARRAY[resource_type || ':use:all'])
            OR (security.can_any(ARRAY[resource_type || ':use:own']) AND security.has_access(resource_type, resource_id))
          )
        );
    `,
    `
      CREATE POLICY ai_agent_tool_resources_delete ON public.ai_agent_tool_resources
        FOR DELETE
        USING (
          security.can_any(ARRAY['ai_agent:update:all'])
          OR (security.can_any(ARRAY['ai_agent:update:own']) AND security.has_access('ai_agent', agent_id, ARRAY['editor']))
        );
    `,

    // Triage Specialists
    ...protectTable("ai_triage_specialists"),
    `
      CREATE POLICY ai_triage_specialists_select ON public.ai_triage_specialists
        FOR SELECT
        USING (
          security.can_any(ARRAY['ai_agent:read:all', 'ai_agent:update:all', 'ai_agent:use:all'])
          OR (
            security.can_any(ARRAY['ai_agent:read:own', 'ai_agent:update:own', 'ai_agent:use:own'])
            AND security.has_access('ai_agent', triage_agent_id)
          )
        );
    `,
    `
      CREATE POLICY ai_triage_specialists_insert ON public.ai_triage_specialists
        FOR INSERT
        WITH CHECK (
          -- Requires update permission on the triage agent
          (
            security.can_any(ARRAY['ai_agent:update:all'])
            OR (security.can_any(ARRAY['ai_agent:update:own']) AND security.has_access('ai_agent', triage_agent_id, ARRAY['editor']))
          )
          -- Requires use permission on the specialist agent being assigned
          AND (
            security.can_any(ARRAY['ai_agent:use:all'])
            OR (security.can_any(ARRAY['ai_agent:use:own']) AND security.has_access('ai_agent', specialist_agent_id))
          )
        );
    `,
    `
      CREATE POLICY ai_triage_specialists_delete ON public.ai_triage_specialists
        FOR DELETE
        USING (
          security.can_any(ARRAY['ai_agent:update:all'])
          OR (security.can_any(ARRAY['ai_agent:update:own']) AND security.has_access('ai_agent', triage_agent_id, ARRAY['editor']))
        );
    `,

    // Agent Executions
    ...protectTable("ai_agent_executions"),
    `
      CREATE POLICY ai_agent_executions_select ON public.ai_agent_executions
        FOR SELECT
        USING (
          security.can_any(ARRAY['ai_agent_execution:read:all', 'ai_agent_execution:list:all'])
          OR (user_id = security.user_id() AND security.can_any(ARRAY['ai_agent_execution:read:own', 'ai_agent_execution:list:own']))
        );
    `,
    `
      CREATE POLICY ai_agent_executions_insert ON public.ai_agent_executions
        FOR INSERT
        WITH CHECK (
          user_id = security.user_id()
          AND security.can_any(ARRAY['ai_chat:create'])
          -- Requires use permission on the agent being executed
          AND (
            security.can_any(ARRAY['ai_agent:use:all'])
            OR (
              security.can_any(ARRAY['ai_agent:use:own'])
              AND security.has_access('ai_agent', agent_id)
            )
          )
          -- Requires ownership of the chat session
          AND (session_id IS NULL OR security.is_owner('ai_chat', session_id))
        );
    `,
    `
      CREATE POLICY ai_agent_executions_update ON public.ai_agent_executions
        FOR UPDATE
        USING (
          security.can_any(ARRAY['ai_agent_execution:cancel:all'])
          OR (user_id = security.user_id() AND security.can_any(ARRAY['ai_agent_execution:cancel:own']))
        )
        WITH CHECK (
          security.can_any(ARRAY['ai_agent_execution:cancel:all'])
          OR (user_id = security.user_id() AND security.can_any(ARRAY['ai_agent_execution:cancel:own']))
        );
    `,

    // Agent Code Executions
    ...protectTable("ai_agent_code_executions"),
    `
      CREATE POLICY ai_agent_code_executions_select ON public.ai_agent_code_executions
        FOR SELECT
        USING (
          security.can_any(ARRAY['ai_agent_execution:list:all', 'ai_agent_execution:read:all'])
          OR (security.can_any(ARRAY['ai_agent_execution:list:own', 'ai_agent_execution:read:own']) AND security.is_owner('ai_agent_execution', execution_id))
        );
    `,
    `
      CREATE POLICY ai_agent_code_executions_insert ON public.ai_agent_code_executions
        FOR INSERT
        WITH CHECK (
          security.can_any(ARRAY['ai_chat:create']) AND security.is_owner('ai_agent_execution', execution_id)
        );
    `,
    `
      CREATE POLICY ai_agent_code_executions_update ON public.ai_agent_code_executions
        FOR UPDATE
        USING (
          security.can_any(ARRAY['ai_chat:update:own']) AND security.is_owner('ai_agent_execution', execution_id)
        )
        WITH CHECK (
          security.can_any(ARRAY['ai_chat:update:own']) AND security.is_owner('ai_agent_execution', execution_id)
        );
    `,

    // Agent Tool Calls
    ...protectTable("ai_agent_tool_calls"),
    `
      CREATE POLICY ai_agent_tool_calls_select ON public.ai_agent_tool_calls
        FOR SELECT
        USING (
          security.can_any(ARRAY['ai_agent_execution:list:all', 'ai_agent_execution:read:all'])
          OR (security.can_any(ARRAY['ai_agent_execution:list:own', 'ai_agent_execution:read:own']) AND security.is_owner('ai_agent_execution', execution_id))
        );
    `,
    `
      CREATE POLICY ai_agent_tool_calls_insert ON public.ai_agent_tool_calls
        FOR INSERT
        WITH CHECK (
          security.can_any(ARRAY['ai_chat:create']) AND security.is_owner('ai_agent_execution', execution_id)
        );
    `,
    `
      CREATE POLICY ai_agent_tool_calls_update ON public.ai_agent_tool_calls
        FOR UPDATE
        USING (
          security.can_any(ARRAY['ai_chat:update:own']) AND security.is_owner('ai_agent_execution', execution_id)
        )
        WITH CHECK (
          security.can_any(ARRAY['ai_chat:update:own']) AND security.is_owner('ai_agent_execution', execution_id)
        );
    `,
  ],
};
