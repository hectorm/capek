import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "~~/shared/schema";

export const up = async (db: Kysely<Database>): Promise<void> => {
  // =============================================================================
  // Security Schema and RLS Setup
  // =============================================================================
  //
  // This repeatable migration owns the `security` schema and the RLS state for
  // public tables. It recreates the helper functions used by policies and the
  // policies attached to the managed tables in `public`.
  //
  // HOW IT WORKS:
  // -------------
  // 1. Application sets session variables via withUserTransaction():
  //    - app.user_id: Current user's UUID
  //    - app.user_groups: Array of group UUIDs the user belongs to
  //    - app.user_permissions: Array of permission strings (e.g., 'agent:read:own')
  //
  // 2. Helper functions read these variables:
  //    - security.user_id(): Returns current user ID (NULL for system operations)
  //    - security.user_groups(): Returns user's group memberships
  //    - security.user_permissions(): Returns the current user's permissions
  //    - security.can()/security.can_any(): Check whether required permissions are present
  //    - security.is_owner(): Checks ownership of user-owned resources
  //    - security.has_access(): Checks access granted through *_access tables
  //    - security.agent_has_linked_resource(): Checks linked resources during agent updates
  //
  // 3. Policies on public tables use those helpers to define who can
  //    SELECT/INSERT/UPDATE/DELETE each row.
  //
  // POLICY PATTERNS:
  // ----------------
  // *_system policies:
  //   Allow system operations (migrations, scheduled tasks) when security.user_id() IS NULL.
  //   These bypass all user-level restrictions.
  //
  // Permission-based access:
  //   - ':all' permissions (e.g., 'agent:read:all') grant access to ALL rows
  //   - ':own' permissions (e.g., 'agent:read:own') require additional ownership checks
  //
  // Ownership via access tables:
  //   Resources like agents, llm_providers, mcp_servers, and skills use *_access tables
  //   to track who has access. Two roles exist:
  //   - 'editor': Can update, delete, and grant access to others
  //   - 'user': Can read and execute (use) the resource
  //
  // Access can be granted to:
  //   - Individual users (user_id column)
  //   - Groups (group_id column), all group members inherit access
  //
  // Implicit access:
  //   Some resources are visible through relationships:
  //   - Agent editors can see the LLM provider, MCP servers, and skills their agent uses
  //   - Triage editors can see specialist agents attached to their triage
  //   - Resource editors can see users/groups with whom they share access
  //
  // =============================================================================

  await db.schema.createSchema("security").execute();

  // Function to get user ID from session variable
  await sql`
    CREATE FUNCTION security.user_id()
    RETURNS UUID
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT NULLIF(CURRENT_SETTING('app.user_id', TRUE), '')::UUID;
    $$
  `.execute(db);

  // Function to get user group IDs from session variable
  await sql`
    CREATE FUNCTION security.user_groups()
    RETURNS UUID[]
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT NULLIF(CURRENT_SETTING('app.user_groups', TRUE), '')::UUID[];
    $$
  `.execute(db);

  // Function to get user permissions from session variable
  await sql`
    CREATE FUNCTION security.user_permissions()
    RETURNS TEXT[]
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT NULLIF(CURRENT_SETTING('app.user_permissions', TRUE), '')::TEXT[];
    $$
  `.execute(db);

  // Function to check if user has ALL permissions from the list
  await sql`
    CREATE FUNCTION security.can(permissions TEXT[])
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT security.user_id() IS NOT NULL AND COALESCE(permissions <@ security.user_permissions(), FALSE);
    $$;
  `.execute(db);

  // Function to check if user has ANY permission from the list
  await sql`
    CREATE FUNCTION security.can_any(permissions TEXT[])
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT security.user_id() IS NOT NULL AND COALESCE(permissions && security.user_permissions(), FALSE);
    $$;
  `.execute(db);

  // Function to check if user owns a resource with direct user_id ownership
  await sql`
    CREATE FUNCTION security.is_owner(resource_type TEXT, resource_id UUID)
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT CASE resource_type
        WHEN 'chat_session' THEN EXISTS (
          SELECT 1 FROM public.chat_sessions
          WHERE id = resource_id AND user_id = security.user_id()
        )
        WHEN 'execution' THEN EXISTS (
          SELECT 1 FROM public.agent_executions
          WHERE id = resource_id AND user_id = security.user_id()
        )
        ELSE FALSE
      END;
    $$;
  `.execute(db);

  // Function to check if user has direct access to a shared resource via access tables
  await sql`
    CREATE FUNCTION security.has_access(resource_type TEXT, resource_id UUID, required_roles TEXT[] DEFAULT ARRAY['editor', 'user'])
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT CASE resource_type
        WHEN 'agent' THEN EXISTS (
          SELECT 1 FROM public.agent_access
          WHERE agent_id = resource_id
            AND role = ANY(required_roles)
            AND (user_id = security.user_id() OR group_id = ANY(security.user_groups()))
        )
        WHEN 'llm_provider' THEN EXISTS (
          SELECT 1 FROM public.llm_provider_access
          WHERE llm_provider_id = resource_id
            AND role = ANY(required_roles)
            AND (user_id = security.user_id() OR group_id = ANY(security.user_groups()))
        )
        WHEN 'mcp_server' THEN EXISTS (
          SELECT 1 FROM public.mcp_server_access
          WHERE mcp_server_id = resource_id
            AND role = ANY(required_roles)
            AND (user_id = security.user_id() OR group_id = ANY(security.user_groups()))
        )
        WHEN 'skill' THEN EXISTS (
          SELECT 1 FROM public.skill_access
          WHERE skill_id = resource_id
            AND role = ANY(required_roles)
            AND (user_id = security.user_id() OR group_id = ANY(security.user_groups()))
        )
        ELSE FALSE
      END;
    $$;
  `.execute(db);

  // Function to check whether a specific agent already links to a specific resource.
  // This is used for context-scoped access checks that should not become reusable access across agents.
  await sql`
    CREATE FUNCTION security.agent_has_linked_resource(agent_id UUID, resource_type TEXT, resource_id UUID)
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT CASE resource_type
          WHEN 'llm_provider' THEN EXISTS (
            SELECT 1 FROM public.agents
            WHERE agents.id = agent_id
              AND agents.llm_provider_id = resource_id
          )
          ELSE FALSE
        END;
    $$;
  `.execute(db);

  // =============================================================================
  // RLS Policies: Users
  // =============================================================================

  await sql`ALTER TABLE public.users ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.users FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY users_system ON public.users
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY users_select ON public.users
      FOR SELECT
      USING (
        security.can_any(ARRAY['user:read:all', 'user:list:all'])
        OR (id = security.user_id() AND security.can_any(ARRAY['user:read:own']))
        -- Implicit: editors can see users with whom they share resource access
        OR EXISTS (
          SELECT 1 FROM public.agent_access aa1
          INNER JOIN public.agent_access aa2 ON aa1.agent_id = aa2.agent_id
          WHERE aa2.user_id = users.id
          AND aa1.role = 'editor'
          AND (aa1.user_id = security.user_id() OR aa1.group_id = ANY(security.user_groups()))
        )
        OR EXISTS (
          SELECT 1 FROM public.llm_provider_access lpa1
          INNER JOIN public.llm_provider_access lpa2 ON lpa1.llm_provider_id = lpa2.llm_provider_id
          WHERE lpa2.user_id = users.id
          AND lpa1.role = 'editor'
          AND (lpa1.user_id = security.user_id() OR lpa1.group_id = ANY(security.user_groups()))
        )
        OR EXISTS (
          SELECT 1 FROM public.mcp_server_access msa1
          INNER JOIN public.mcp_server_access msa2 ON msa1.mcp_server_id = msa2.mcp_server_id
          WHERE msa2.user_id = users.id
          AND msa1.role = 'editor'
          AND (msa1.user_id = security.user_id() OR msa1.group_id = ANY(security.user_groups()))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY users_insert ON public.users
      FOR INSERT
      WITH CHECK (security.can_any(ARRAY['user:create']));
  `.execute(db);

  await sql`
    CREATE POLICY users_update ON public.users
      FOR UPDATE
      USING (
        security.can_any(ARRAY['user:update:all'])
        OR (id = security.user_id() AND security.can_any(ARRAY['user:update:own']))
      )
      WITH CHECK (
        security.can_any(ARRAY['user:update:all'])
        OR (id = security.user_id() AND security.can_any(ARRAY['user:update:own']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY users_delete ON public.users
      FOR DELETE
      USING (security.can_any(ARRAY['user:delete:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Groups
  // =============================================================================

  await sql`ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.groups FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY groups_system ON public.groups
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY groups_select ON public.groups
      FOR SELECT
      USING (
        security.can_any(ARRAY['group:read:all', 'group:list:all'])
        OR (
          security.can_any(ARRAY['group:read:own', 'group:list:own'])
          AND EXISTS (
            SELECT 1 FROM public.user_groups
            WHERE user_groups.group_id = groups.id
            AND user_groups.user_id = security.user_id()
          )
        )
        -- Implicit: editors can see groups with whom they share resource access
        OR EXISTS (
          SELECT 1 FROM public.agent_access aa1
          INNER JOIN public.agent_access aa2 ON aa1.agent_id = aa2.agent_id
          WHERE aa2.group_id = groups.id
          AND aa1.role = 'editor'
          AND (aa1.user_id = security.user_id() OR aa1.group_id = ANY(security.user_groups()))
        )
        OR EXISTS (
          SELECT 1 FROM public.llm_provider_access lpa1
          INNER JOIN public.llm_provider_access lpa2 ON lpa1.llm_provider_id = lpa2.llm_provider_id
          WHERE lpa2.group_id = groups.id
          AND lpa1.role = 'editor'
          AND (lpa1.user_id = security.user_id() OR lpa1.group_id = ANY(security.user_groups()))
        )
        OR EXISTS (
          SELECT 1 FROM public.mcp_server_access msa1
          INNER JOIN public.mcp_server_access msa2 ON msa1.mcp_server_id = msa2.mcp_server_id
          WHERE msa2.group_id = groups.id
          AND msa1.role = 'editor'
          AND (msa1.user_id = security.user_id() OR msa1.group_id = ANY(security.user_groups()))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY groups_insert ON public.groups
      FOR INSERT
      WITH CHECK (security.can_any(ARRAY['group:create']));
  `.execute(db);

  await sql`
    CREATE POLICY groups_update ON public.groups
      FOR UPDATE
      USING (security.can_any(ARRAY['group:update:all']))
      WITH CHECK (security.can_any(ARRAY['group:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY groups_delete ON public.groups
      FOR DELETE
      USING (security.can_any(ARRAY['group:delete:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Roles
  // =============================================================================

  await sql`ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.roles FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY roles_system ON public.roles
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY roles_select ON public.roles
      FOR SELECT
      USING (true);
  `.execute(db);

  // =============================================================================
  // RLS Policies: Permissions
  // =============================================================================

  await sql`ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY permissions_system ON public.permissions
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY permissions_select ON public.permissions
      FOR SELECT
      USING (true);
  `.execute(db);

  // =============================================================================
  // RLS Policies: User Groups
  // =============================================================================

  await sql`ALTER TABLE public.user_groups ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.user_groups FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY user_groups_system ON public.user_groups
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY user_groups_select ON public.user_groups
      FOR SELECT
      USING (
        security.can_any(ARRAY['user:read:all', 'user:list:all', 'group:read:all', 'group:list:all'])
        OR user_id = security.user_id()
      );
  `.execute(db);

  await sql`
    CREATE POLICY user_groups_insert ON public.user_groups
      FOR INSERT
      WITH CHECK (security.can_any(ARRAY['user:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY user_groups_delete ON public.user_groups
      FOR DELETE
      USING (security.can_any(ARRAY['user:update:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: User Roles
  // =============================================================================

  await sql`ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY user_roles_system ON public.user_roles
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY user_roles_select ON public.user_roles
      FOR SELECT
      USING (
        security.can_any(ARRAY['user:read:all', 'user:list:all'])
        OR user_id = security.user_id()
      );
  `.execute(db);

  await sql`
    CREATE POLICY user_roles_insert ON public.user_roles
      FOR INSERT
      WITH CHECK (security.can_any(ARRAY['user:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY user_roles_delete ON public.user_roles
      FOR DELETE
      USING (security.can_any(ARRAY['user:update:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Group Roles
  // =============================================================================

  await sql`ALTER TABLE public.group_roles ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.group_roles FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY group_roles_system ON public.group_roles
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY group_roles_select ON public.group_roles
      FOR SELECT
      USING (
        security.can_any(ARRAY['group:read:all', 'group:list:all'])
        OR (
          security.can_any(ARRAY['group:read:own', 'group:list:own'])
          AND EXISTS (
            SELECT 1 FROM public.user_groups
            WHERE user_groups.group_id = group_roles.group_id
            AND user_groups.user_id = security.user_id()
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY group_roles_insert ON public.group_roles
      FOR INSERT
      WITH CHECK (security.can_any(ARRAY['group:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY group_roles_delete ON public.group_roles
      FOR DELETE
      USING (security.can_any(ARRAY['group:update:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Role Permissions
  // =============================================================================

  await sql`ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY role_permissions_system ON public.role_permissions
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY role_permissions_select ON public.role_permissions
      FOR SELECT
      USING (true);
  `.execute(db);

  // =============================================================================
  // RLS Policies: Accounts
  // =============================================================================

  await sql`ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY accounts_system ON public.accounts
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  // =============================================================================
  // RLS Policies: Sessions
  // =============================================================================

  await sql`ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.sessions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY sessions_system ON public.sessions
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  // =============================================================================
  // RLS Policies: Settings
  // =============================================================================

  await sql`ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.settings FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY settings_system ON public.settings
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY settings_select ON public.settings
      FOR SELECT
      -- Note: public vs private filtering is handled at application level
      USING (security.can_any(ARRAY['settings:read:all', 'settings:list:all', 'settings:read:public', 'settings:list:public']));
  `.execute(db);

  await sql`
    CREATE POLICY settings_insert ON public.settings
      FOR INSERT
      WITH CHECK (security.can_any(ARRAY['settings:create']));
  `.execute(db);

  await sql`
    CREATE POLICY settings_update ON public.settings
      FOR UPDATE
      USING (security.can_any(ARRAY['settings:update:all']))
      WITH CHECK (security.can_any(ARRAY['settings:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY settings_delete ON public.settings
      FOR DELETE
      USING (security.can_any(ARRAY['settings:delete:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Chat Sessions
  // =============================================================================

  await sql`ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.chat_sessions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY chat_sessions_system ON public.chat_sessions
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY chat_sessions_select ON public.chat_sessions
      FOR SELECT
      USING (
        security.can_any(ARRAY['chat:read:all', 'chat:list:all'])
        OR (user_id = security.user_id() AND security.can_any(ARRAY['chat:read:own', 'chat:list:own']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_sessions_insert ON public.chat_sessions
      FOR INSERT
      WITH CHECK (
        user_id = security.user_id()
        AND security.can_any(ARRAY['chat:create'])
        -- Requires use permission on the agent being attached
        AND (
          agent_id IS NULL
          OR security.can_any(ARRAY['agent:use:all'])
          OR (
            security.can_any(ARRAY['agent:use:own'])
            AND security.has_access('agent', agent_id)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_sessions_update ON public.chat_sessions
      FOR UPDATE
      USING (
        security.can_any(ARRAY['chat:update:all'])
        OR (user_id = security.user_id() AND security.can_any(ARRAY['chat:update:own']))
      )
      WITH CHECK (
        (
          security.can_any(ARRAY['chat:update:all'])
          OR (user_id = security.user_id() AND security.can_any(ARRAY['chat:update:own']))
        )
        -- Requires use permission on the agent being attached
        AND (
          agent_id IS NULL
          OR security.can_any(ARRAY['agent:use:all'])
          OR (
            security.can_any(ARRAY['agent:use:own'])
            AND security.has_access('agent', agent_id)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_sessions_delete ON public.chat_sessions
      FOR DELETE
      USING (
        security.can_any(ARRAY['chat:delete:all'])
        OR (user_id = security.user_id() AND security.can_any(ARRAY['chat:delete:own']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Chat Messages
  // =============================================================================

  await sql`ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.chat_messages FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY chat_messages_system ON public.chat_messages
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY chat_messages_select ON public.chat_messages
      FOR SELECT
      USING (
        security.can_any(ARRAY['chat:read:all', 'chat:list:all'])
        OR (security.can_any(ARRAY['chat:read:own', 'chat:list:own']) AND security.is_owner('chat_session', session_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_messages_insert ON public.chat_messages
      FOR INSERT
      WITH CHECK (
        security.can_any(ARRAY['chat:create']) AND security.is_owner('chat_session', session_id)
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_messages_update ON public.chat_messages
      FOR UPDATE
      USING (
        security.can_any(ARRAY['chat:update:all'])
        -- Users can only update their own 'user' role messages (not AI responses)
        OR (security.can_any(ARRAY['chat:update:own']) AND role = 'user' AND security.is_owner('chat_session', session_id))
      )
      WITH CHECK (
        security.can_any(ARRAY['chat:update:all'])
        OR (security.can_any(ARRAY['chat:update:own']) AND role = 'user' AND security.is_owner('chat_session', session_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_messages_delete ON public.chat_messages
      FOR DELETE
      USING (
        security.can_any(ARRAY['chat:delete:all'])
        OR (security.can_any(ARRAY['chat:delete:own']) AND security.is_owner('chat_session', session_id))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Chat Session VFS
  // =============================================================================

  await sql`ALTER TABLE public.chat_session_vfs ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.chat_session_vfs FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_system ON public.chat_session_vfs
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_select ON public.chat_session_vfs
      FOR SELECT
      USING (security.is_owner('chat_session', session_id));
  `.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_insert ON public.chat_session_vfs
      FOR INSERT
      WITH CHECK (security.is_owner('chat_session', session_id));
  `.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_update ON public.chat_session_vfs
      FOR UPDATE
      USING (security.is_owner('chat_session', session_id))
      WITH CHECK (security.is_owner('chat_session', session_id));
  `.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_delete ON public.chat_session_vfs
      FOR DELETE
      USING (security.is_owner('chat_session', session_id));
  `.execute(db);

  // =============================================================================
  // RLS Policies: LLM Providers
  // =============================================================================

  await sql`ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.llm_providers FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY llm_providers_system ON public.llm_providers
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY llm_providers_select ON public.llm_providers
      FOR SELECT
      USING (
        security.can_any(ARRAY['llm_provider:read:all', 'llm_provider:list:all', 'llm_provider:update:all', 'llm_provider:delete:all', 'llm_provider:use:all'])
        OR (
          security.can_any(ARRAY['llm_provider:read:own', 'llm_provider:list:own', 'llm_provider:update:own', 'llm_provider:delete:own', 'llm_provider:use:own'])
          AND security.has_access('llm_provider', id)
        )
        -- Let creators see rows in the current transaction with no access grants
        -- to other users or groups so they can insert their initial self-access rows
        OR (
          security.can_any(ARRAY['llm_provider:create'])
          AND age(llm_providers.xmin) = 0
          AND NOT EXISTS (
            SELECT 1 FROM public.llm_provider_access lpa
            WHERE lpa.llm_provider_id = llm_providers.id
            AND (lpa.user_id IS DISTINCT FROM security.user_id() OR lpa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY llm_providers_insert ON public.llm_providers
      FOR INSERT
      WITH CHECK (security.can_any(ARRAY['llm_provider:create']));
  `.execute(db);

  await sql`
    CREATE POLICY llm_providers_update ON public.llm_providers
      FOR UPDATE
      USING (
        security.can_any(ARRAY['llm_provider:update:all'])
        OR (security.can_any(ARRAY['llm_provider:update:own']) AND security.has_access('llm_provider', id, ARRAY['editor']))
      )
      WITH CHECK (
        security.can_any(ARRAY['llm_provider:update:all'])
        OR (security.can_any(ARRAY['llm_provider:update:own']) AND security.has_access('llm_provider', id, ARRAY['editor']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY llm_providers_delete ON public.llm_providers
      FOR DELETE
      USING (
        security.can_any(ARRAY['llm_provider:delete:all'])
        OR (security.can_any(ARRAY['llm_provider:delete:own']) AND security.has_access('llm_provider', id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: LLM Provider Access
  // =============================================================================

  await sql`ALTER TABLE public.llm_provider_access ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.llm_provider_access FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY llm_provider_access_system ON public.llm_provider_access
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  // Note: Doesn't filter by resource access to avoid RLS recursion (has_access queries this table).
  // Users with :own permissions can see access metadata for all resources, but not resource content.
  await sql`
    CREATE POLICY llm_provider_access_select ON public.llm_provider_access
      FOR SELECT
      USING (
        security.can_any(ARRAY['llm_provider:read:all', 'llm_provider:update:all', 'llm_provider:read:own', 'llm_provider:update:own'])
      );
  `.execute(db);

  await sql`
    CREATE POLICY llm_provider_access_insert ON public.llm_provider_access
      FOR INSERT
      WITH CHECK (
        security.can_any(ARRAY['llm_provider:update:all'])
        OR (security.can_any(ARRAY['llm_provider:update:own']) AND security.has_access('llm_provider', llm_provider_id, ARRAY['editor']))
        -- Implicit creator self-grant: creator can grant access to themselves only for resources
        -- created in the current transaction, and only when no other users or groups have access
        OR (
          security.can_any(ARRAY['llm_provider:create'])
          AND user_id = security.user_id()
          AND EXISTS (
            SELECT 1 FROM public.llm_providers lp
            WHERE lp.id = llm_provider_access.llm_provider_id
            AND age(lp.xmin) = 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.llm_provider_access lpa
            WHERE lpa.llm_provider_id = llm_provider_access.llm_provider_id
            AND (lpa.user_id IS DISTINCT FROM security.user_id() OR lpa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY llm_provider_access_delete ON public.llm_provider_access
      FOR DELETE
      USING (
        security.can_any(ARRAY['llm_provider:update:all'])
        OR (security.can_any(ARRAY['llm_provider:update:own']) AND security.has_access('llm_provider', llm_provider_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: MCP Servers
  // =============================================================================

  await sql`ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.mcp_servers FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY mcp_servers_system ON public.mcp_servers
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY mcp_servers_select ON public.mcp_servers
      FOR SELECT
      USING (
        security.can_any(ARRAY['mcp_server:read:all', 'mcp_server:list:all', 'mcp_server:update:all', 'mcp_server:delete:all', 'mcp_server:use:all'])
        OR (
          security.can_any(ARRAY['mcp_server:read:own', 'mcp_server:list:own', 'mcp_server:update:own', 'mcp_server:delete:own', 'mcp_server:use:own'])
          AND security.has_access('mcp_server', id)
        )
        -- Let creators see rows in the current transaction with no access grants
        -- to other users or groups so they can insert their initial self-access rows
        OR (
          security.can_any(ARRAY['mcp_server:create'])
          AND age(mcp_servers.xmin) = 0
          AND NOT EXISTS (
            SELECT 1 FROM public.mcp_server_access msa
            WHERE msa.mcp_server_id = mcp_servers.id
            AND (msa.user_id IS DISTINCT FROM security.user_id() OR msa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY mcp_servers_insert ON public.mcp_servers
      FOR INSERT
      WITH CHECK (security.can_any(ARRAY['mcp_server:create']));
  `.execute(db);

  await sql`
    CREATE POLICY mcp_servers_update ON public.mcp_servers
      FOR UPDATE
      USING (
        security.can_any(ARRAY['mcp_server:update:all'])
        OR (security.can_any(ARRAY['mcp_server:update:own']) AND security.has_access('mcp_server', id, ARRAY['editor']))
      )
      WITH CHECK (
        security.can_any(ARRAY['mcp_server:update:all'])
        OR (security.can_any(ARRAY['mcp_server:update:own']) AND security.has_access('mcp_server', id, ARRAY['editor']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY mcp_servers_delete ON public.mcp_servers
      FOR DELETE
      USING (
        security.can_any(ARRAY['mcp_server:delete:all'])
        OR (security.can_any(ARRAY['mcp_server:delete:own']) AND security.has_access('mcp_server', id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: MCP Server Access
  // =============================================================================

  await sql`ALTER TABLE public.mcp_server_access ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.mcp_server_access FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY mcp_server_access_system ON public.mcp_server_access
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  // Note: See llm_provider_access_select comment
  await sql`
    CREATE POLICY mcp_server_access_select ON public.mcp_server_access
      FOR SELECT
      USING (
        security.can_any(ARRAY['mcp_server:read:all', 'mcp_server:update:all', 'mcp_server:read:own', 'mcp_server:update:own'])
      );
  `.execute(db);

  await sql`
    CREATE POLICY mcp_server_access_insert ON public.mcp_server_access
      FOR INSERT
      WITH CHECK (
        security.can_any(ARRAY['mcp_server:update:all'])
        OR (security.can_any(ARRAY['mcp_server:update:own']) AND security.has_access('mcp_server', mcp_server_id, ARRAY['editor']))
        -- Implicit creator self-grant: creator can grant access to themselves only for resources
        -- created in the current transaction, and only when no other users or groups have access
        OR (
          security.can_any(ARRAY['mcp_server:create'])
          AND user_id = security.user_id()
          AND EXISTS (
            SELECT 1 FROM public.mcp_servers ms
            WHERE ms.id = mcp_server_access.mcp_server_id
            AND age(ms.xmin) = 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.mcp_server_access msa
            WHERE msa.mcp_server_id = mcp_server_access.mcp_server_id
            AND (msa.user_id IS DISTINCT FROM security.user_id() OR msa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY mcp_server_access_delete ON public.mcp_server_access
      FOR DELETE
      USING (
        security.can_any(ARRAY['mcp_server:update:all'])
        OR (security.can_any(ARRAY['mcp_server:update:own']) AND security.has_access('mcp_server', mcp_server_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Skills
  // =============================================================================

  await sql`ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.skills FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY skills_system ON public.skills
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY skills_select ON public.skills
      FOR SELECT
      USING (
        security.can_any(ARRAY['skill:read:all', 'skill:list:all', 'skill:update:all', 'skill:delete:all', 'skill:use:all'])
        OR (
          security.can_any(ARRAY['skill:read:own', 'skill:list:own', 'skill:update:own', 'skill:delete:own', 'skill:use:own'])
          AND security.has_access('skill', id)
        )
        -- Let creators see rows in the current transaction with no access grants
        -- to other users or groups so they can insert their initial self-access rows
        OR (
          security.can_any(ARRAY['skill:create'])
          AND age(skills.xmin) = 0
          AND NOT EXISTS (
            SELECT 1 FROM public.skill_access sa
            WHERE sa.skill_id = skills.id
            AND (sa.user_id IS DISTINCT FROM security.user_id() OR sa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY skills_insert ON public.skills
      FOR INSERT
      WITH CHECK (security.can_any(ARRAY['skill:create']));
  `.execute(db);

  await sql`
    CREATE POLICY skills_update ON public.skills
      FOR UPDATE
      USING (
        security.can_any(ARRAY['skill:update:all'])
        OR (security.can_any(ARRAY['skill:update:own']) AND security.has_access('skill', id, ARRAY['editor']))
      )
      WITH CHECK (
        security.can_any(ARRAY['skill:update:all'])
        OR (security.can_any(ARRAY['skill:update:own']) AND security.has_access('skill', id, ARRAY['editor']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY skills_delete ON public.skills
      FOR DELETE
      USING (
        security.can_any(ARRAY['skill:delete:all'])
        OR (security.can_any(ARRAY['skill:delete:own']) AND security.has_access('skill', id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Skill Access
  // =============================================================================

  await sql`ALTER TABLE public.skill_access ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.skill_access FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY skill_access_system ON public.skill_access
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  // Note: See llm_provider_access_select comment
  await sql`
    CREATE POLICY skill_access_select ON public.skill_access
      FOR SELECT
      USING (
        security.can_any(ARRAY['skill:read:all', 'skill:update:all', 'skill:read:own', 'skill:update:own'])
      );
  `.execute(db);

  await sql`
    CREATE POLICY skill_access_insert ON public.skill_access
      FOR INSERT
      WITH CHECK (
        security.can_any(ARRAY['skill:update:all'])
        OR (security.can_any(ARRAY['skill:update:own']) AND security.has_access('skill', skill_id, ARRAY['editor']))
        -- Implicit creator self-grant: creator can grant access to themselves only for resources
        -- created in the current transaction, and only when no other users or groups have access
        OR (
          security.can_any(ARRAY['skill:create'])
          AND user_id = security.user_id()
          AND EXISTS (
            SELECT 1 FROM public.skills s
            WHERE s.id = skill_access.skill_id
            AND age(s.xmin) = 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.skill_access sa
            WHERE sa.skill_id = skill_access.skill_id
            AND (sa.user_id IS DISTINCT FROM security.user_id() OR sa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY skill_access_delete ON public.skill_access
      FOR DELETE
      USING (
        security.can_any(ARRAY['skill:update:all'])
        OR (security.can_any(ARRAY['skill:update:own']) AND security.has_access('skill', skill_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agents
  // =============================================================================

  await sql`ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agents FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agents_system ON public.agents
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agents_select ON public.agents
      FOR SELECT
      USING (
        security.can_any(ARRAY['agent:read:all', 'agent:list:all', 'agent:update:all', 'agent:delete:all', 'agent:use:all'])
        OR (
          security.can_any(ARRAY['agent:read:own', 'agent:list:own', 'agent:update:own', 'agent:delete:own', 'agent:use:own'])
          AND security.has_access('agent', id)
        )
        -- Let creators see rows in the current transaction with no access grants
        -- to other users or groups so they can insert their initial self-access rows
        OR (
          security.can_any(ARRAY['agent:create'])
          AND age(agents.xmin) = 0
          AND NOT EXISTS (
            SELECT 1 FROM public.agent_access aa
            WHERE aa.agent_id = agents.id
            AND (aa.user_id IS DISTINCT FROM security.user_id() OR aa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agents_insert ON public.agents
      FOR INSERT
      WITH CHECK (
        security.can_any(ARRAY['agent:create'])
        -- Requires use permission on the LLM provider being assigned
        AND (
          llm_provider_id IS NULL
          OR security.can_any(ARRAY['llm_provider:use:all'])
          OR (
            security.can_any(ARRAY['llm_provider:use:own'])
            AND security.has_access('llm_provider', llm_provider_id)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agents_update ON public.agents
      FOR UPDATE
      USING (
        security.can_any(ARRAY['agent:update:all'])
        OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', id, ARRAY['editor']))
      )
      WITH CHECK (
        -- Requires update permission on the agent
        (
          security.can_any(ARRAY['agent:update:all'])
          OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', id, ARRAY['editor']))
        )
        -- Requires use permission on the LLM provider being assigned
        AND (
          llm_provider_id IS NULL
          OR security.can_any(ARRAY['llm_provider:use:all'])
          OR (
            security.can_any(ARRAY['llm_provider:use:own'])
            AND (
              security.has_access('llm_provider', llm_provider_id)
              OR security.agent_has_linked_resource(id, 'llm_provider', llm_provider_id)
            )
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agents_delete ON public.agents
      FOR DELETE
      USING (
        security.can_any(ARRAY['agent:delete:all'])
        OR (security.can_any(ARRAY['agent:delete:own']) AND security.has_access('agent', id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Access
  // =============================================================================

  await sql`ALTER TABLE public.agent_access ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_access FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_access_system ON public.agent_access
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  // Note: See llm_provider_access_select comment
  await sql`
    CREATE POLICY agent_access_select ON public.agent_access
      FOR SELECT
      USING (
        security.can_any(ARRAY['agent:read:all', 'agent:update:all', 'agent:read:own', 'agent:update:own'])
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_access_insert ON public.agent_access
      FOR INSERT
      WITH CHECK (
        security.can_any(ARRAY['agent:update:all'])
        OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', agent_id, ARRAY['editor']))
        -- Implicit creator self-grant: creator can grant access to themselves only for resources
        -- created in the current transaction, and only when no other users or groups have access
        OR (
          security.can_any(ARRAY['agent:create'])
          AND user_id = security.user_id()
          AND EXISTS (
            SELECT 1 FROM public.agents a
            WHERE a.id = agent_access.agent_id
            AND age(a.xmin) = 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.agent_access aa
            WHERE aa.agent_id = agent_access.agent_id
            AND (aa.user_id IS DISTINCT FROM security.user_id() OR aa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_access_delete ON public.agent_access
      FOR DELETE
      USING (
        security.can_any(ARRAY['agent:update:all'])
        OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', agent_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent MCP Servers
  // =============================================================================

  await sql`ALTER TABLE public.agent_mcp_servers ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_mcp_servers FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_mcp_servers_system ON public.agent_mcp_servers
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_mcp_servers_select ON public.agent_mcp_servers
      FOR SELECT
      USING (
        security.can_any(ARRAY['agent:read:all', 'agent:update:all', 'agent:use:all'])
        OR (
          security.can_any(ARRAY['agent:read:own', 'agent:update:own', 'agent:use:own'])
          AND security.has_access('agent', agent_id)
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_mcp_servers_insert ON public.agent_mcp_servers
      FOR INSERT
      WITH CHECK (
        -- Requires update permission on the agent
        (
          security.can_any(ARRAY['agent:update:all'])
          OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', agent_id, ARRAY['editor']))
        )
        -- Requires use permission on the MCP server being assigned
        AND (
          security.can_any(ARRAY['mcp_server:use:all'])
          OR (security.can_any(ARRAY['mcp_server:use:own']) AND security.has_access('mcp_server', mcp_server_id))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_mcp_servers_delete ON public.agent_mcp_servers
      FOR DELETE
      USING (
        security.can_any(ARRAY['agent:update:all'])
        OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', agent_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Skills
  // =============================================================================

  await sql`ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_skills FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_skills_system ON public.agent_skills
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_skills_select ON public.agent_skills
      FOR SELECT
      USING (
        security.can_any(ARRAY['agent:read:all', 'agent:update:all', 'agent:use:all'])
        OR (
          security.can_any(ARRAY['agent:read:own', 'agent:update:own', 'agent:use:own'])
          AND security.has_access('agent', agent_id)
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_skills_insert ON public.agent_skills
      FOR INSERT
      WITH CHECK (
        -- Requires update permission on the agent
        (
          security.can_any(ARRAY['agent:update:all'])
          OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', agent_id, ARRAY['editor']))
        )
        -- Requires use permission on the skill being assigned
        AND (
          security.can_any(ARRAY['skill:use:all'])
          OR (security.can_any(ARRAY['skill:use:own']) AND security.has_access('skill', skill_id))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_skills_delete ON public.agent_skills
      FOR DELETE
      USING (
        security.can_any(ARRAY['agent:update:all'])
        OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', agent_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Triage Specialists
  // =============================================================================

  await sql`ALTER TABLE public.triage_specialists ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.triage_specialists FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY triage_specialists_system ON public.triage_specialists
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY triage_specialists_select ON public.triage_specialists
      FOR SELECT
      USING (
        security.can_any(ARRAY['agent:read:all', 'agent:update:all', 'agent:use:all'])
        OR (
          security.can_any(ARRAY['agent:read:own', 'agent:update:own', 'agent:use:own'])
          AND security.has_access('agent', triage_agent_id)
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY triage_specialists_insert ON public.triage_specialists
      FOR INSERT
      WITH CHECK (
        -- Requires update permission on the triage agent
        (
          security.can_any(ARRAY['agent:update:all'])
          OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', triage_agent_id, ARRAY['editor']))
        )
        -- Requires use permission on the specialist agent being assigned
        AND (
          security.can_any(ARRAY['agent:use:all'])
          OR (security.can_any(ARRAY['agent:use:own']) AND security.has_access('agent', specialist_agent_id))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY triage_specialists_delete ON public.triage_specialists
      FOR DELETE
      USING (
        security.can_any(ARRAY['agent:update:all'])
        OR (security.can_any(ARRAY['agent:update:own']) AND security.has_access('agent', triage_agent_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Executions
  // =============================================================================

  await sql`ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_executions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_executions_system ON public.agent_executions
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_executions_select ON public.agent_executions
      FOR SELECT
      USING (
        security.can_any(ARRAY['execution:read:all', 'execution:list:all'])
        OR (user_id = security.user_id() AND security.can_any(ARRAY['execution:read:own', 'execution:list:own']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_executions_insert ON public.agent_executions
      FOR INSERT
      WITH CHECK (
        user_id = security.user_id()
        AND security.can_any(ARRAY['chat:create'])
        -- Requires use permission on the agent being executed
        AND (
          security.can_any(ARRAY['agent:use:all'])
          OR (
            security.can_any(ARRAY['agent:use:own'])
            AND security.has_access('agent', agent_id)
          )
        )
        -- Requires ownership of the chat session
        AND (session_id IS NULL OR security.is_owner('chat_session', session_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_executions_update ON public.agent_executions
      FOR UPDATE
      USING (
        security.can_any(ARRAY['execution:cancel:all'])
        OR (user_id = security.user_id() AND security.can_any(ARRAY['execution:cancel:own']))
      )
      WITH CHECK (
        security.can_any(ARRAY['execution:cancel:all'])
        OR (user_id = security.user_id() AND security.can_any(ARRAY['execution:cancel:own']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Code Executions
  // =============================================================================

  await sql`ALTER TABLE public.agent_code_executions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_code_executions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_code_executions_system ON public.agent_code_executions
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_code_executions_select ON public.agent_code_executions
      FOR SELECT
      USING (
        security.can_any(ARRAY['execution:list:all', 'execution:read:all'])
        OR (security.can_any(ARRAY['execution:list:own', 'execution:read:own']) AND security.is_owner('execution', execution_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_code_executions_insert ON public.agent_code_executions
      FOR INSERT
      WITH CHECK (
        security.can_any(ARRAY['chat:create']) AND security.is_owner('execution', execution_id)
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_code_executions_update ON public.agent_code_executions
      FOR UPDATE
      USING (
        security.can_any(ARRAY['chat:update:own']) AND security.is_owner('execution', execution_id)
      )
      WITH CHECK (
        security.can_any(ARRAY['chat:update:own']) AND security.is_owner('execution', execution_id)
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Tool Calls
  // =============================================================================

  await sql`ALTER TABLE public.agent_tool_calls ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_tool_calls FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_tool_calls_system ON public.agent_tool_calls
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_tool_calls_select ON public.agent_tool_calls
      FOR SELECT
      USING (
        security.can_any(ARRAY['execution:list:all', 'execution:read:all'])
        OR (security.can_any(ARRAY['execution:list:own', 'execution:read:own']) AND security.is_owner('execution', execution_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_tool_calls_insert ON public.agent_tool_calls
      FOR INSERT
      WITH CHECK (
        security.can_any(ARRAY['chat:create']) AND security.is_owner('execution', execution_id)
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_tool_calls_update ON public.agent_tool_calls
      FOR UPDATE
      USING (
        security.can_any(ARRAY['chat:update:own']) AND security.is_owner('execution', execution_id)
      )
      WITH CHECK (
        security.can_any(ARRAY['chat:update:own']) AND security.is_owner('execution', execution_id)
      );
  `.execute(db);
};

export const down = async (db: Kysely<Database>): Promise<void> => {
  await sql`
    DO $$
    DECLARE
      policy_record RECORD;
      table_record RECORD;
    BEGIN
      FOR policy_record IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
      LOOP
        EXECUTE format(
          'DROP POLICY IF EXISTS %I ON %I.%I',
          policy_record.policyname,
          policy_record.schemaname,
          policy_record.tablename
        );
      END LOOP;
      FOR table_record IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public' AND rowsecurity = TRUE
      LOOP
        EXECUTE format(
          'ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY',
          table_record.schemaname,
          table_record.tablename
        );
      END LOOP;
    END
    $$;
  `.execute(db);

  await db.schema.dropSchema("security").ifExists().cascade().execute();
};
