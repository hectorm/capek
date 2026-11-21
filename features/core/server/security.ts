import type { SecurityDefinition } from "#layers/core/server/lib/database/security";
import { protectTable, scopedSelectPolicy, sharesResourceWith } from "#layers/core/server/lib/database/security";

const OWN_USER = "users.id = (SELECT security.user_id())";

const MEMBER_OF_GROUP = `
  EXISTS (
    SELECT 1 FROM public.user_groups
    WHERE user_groups.group_id = groups.id
      AND user_groups.user_id = (SELECT security.user_id())
  )
`;

export const coreSecurity: SecurityDefinition = {
  statements: (ctx) => [
    // Users
    ...protectTable("users"),
    `
      CREATE POLICY users_select ON public.users
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['user:read:all', 'user:list:all']))
          OR (${OWN_USER} AND (SELECT security.can_any(ARRAY['user:read:own'])))
          -- Editors also see the users who have access to the resources that they edit
          OR ${sharesResourceWith(ctx.sharedResources, { userId: "users.id" })}
        );
    `,
    scopedSelectPolicy("users", "user", OWN_USER),
    `
      CREATE POLICY users_insert ON public.users
        FOR INSERT
        WITH CHECK ((SELECT security.can_any(ARRAY['user:create'])));
    `,
    `
      CREATE POLICY users_update ON public.users
        FOR UPDATE
        USING (
          (SELECT security.can_any(ARRAY['user:update:all']))
          OR (id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['user:update:own'])))
        )
        WITH CHECK (
          (SELECT security.can_any(ARRAY['user:update:all']))
          OR (id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['user:update:own'])))
        );
    `,
    `
      CREATE POLICY users_delete ON public.users
        FOR DELETE
        USING ((SELECT security.can_any(ARRAY['user:delete:all'])));
    `,

    // Groups
    ...protectTable("groups"),
    `
      CREATE POLICY groups_select ON public.groups
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['group:read:all', 'group:list:all']))
          OR (
            (SELECT security.can_any(ARRAY['group:read:own', 'group:list:own']))
            AND ${MEMBER_OF_GROUP}
          )
          -- Editors also see the groups that have access to the resources that they edit
          OR ${sharesResourceWith(ctx.sharedResources, { groupId: "groups.id" })}
        );
    `,
    scopedSelectPolicy("groups", "group", MEMBER_OF_GROUP),
    `
      CREATE POLICY groups_insert ON public.groups
        FOR INSERT
        WITH CHECK ((SELECT security.can_any(ARRAY['group:create'])));
    `,
    `
      CREATE POLICY groups_update ON public.groups
        FOR UPDATE
        USING ((SELECT security.can_any(ARRAY['group:update:all'])))
        WITH CHECK ((SELECT security.can_any(ARRAY['group:update:all'])));
    `,
    `
      CREATE POLICY groups_delete ON public.groups
        FOR DELETE
        USING ((SELECT security.can_any(ARRAY['group:delete:all'])));
    `,

    // Roles
    ...protectTable("roles"),
    `
      CREATE POLICY roles_select ON public.roles
        FOR SELECT
        USING (true);
    `,

    // Permissions
    ...protectTable("permissions"),
    `
      CREATE POLICY permissions_select ON public.permissions
        FOR SELECT
        USING (true);
    `,

    // User Groups
    ...protectTable("user_groups"),
    `
      CREATE POLICY user_groups_select ON public.user_groups
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['user:read:all', 'user:list:all', 'group:read:all', 'group:list:all']))
          OR user_id = (SELECT security.user_id())
        );
    `,
    `
      CREATE POLICY user_groups_insert ON public.user_groups
        FOR INSERT
        WITH CHECK ((SELECT security.can_any(ARRAY['user:update:all'])));
    `,
    `
      CREATE POLICY user_groups_delete ON public.user_groups
        FOR DELETE
        USING ((SELECT security.can_any(ARRAY['user:update:all'])));
    `,

    // User Roles
    ...protectTable("user_roles"),
    `
      CREATE POLICY user_roles_select ON public.user_roles
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['user:read:all', 'user:list:all']))
          OR user_id = (SELECT security.user_id())
        );
    `,
    `
      CREATE POLICY user_roles_insert ON public.user_roles
        FOR INSERT
        WITH CHECK ((SELECT security.can_any(ARRAY['user:update:all'])));
    `,
    `
      CREATE POLICY user_roles_delete ON public.user_roles
        FOR DELETE
        USING ((SELECT security.can_any(ARRAY['user:update:all'])));
    `,

    // Group Roles
    ...protectTable("group_roles"),
    `
      CREATE POLICY group_roles_select ON public.group_roles
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['group:read:all', 'group:list:all']))
          OR (
            (SELECT security.can_any(ARRAY['group:read:own', 'group:list:own']))
            AND EXISTS (
              SELECT 1 FROM public.user_groups
              WHERE user_groups.group_id = group_roles.group_id
              AND user_groups.user_id = (SELECT security.user_id())
            )
          )
        );
    `,
    `
      CREATE POLICY group_roles_insert ON public.group_roles
        FOR INSERT
        WITH CHECK ((SELECT security.can_any(ARRAY['group:update:all'])));
    `,
    `
      CREATE POLICY group_roles_delete ON public.group_roles
        FOR DELETE
        USING ((SELECT security.can_any(ARRAY['group:update:all'])));
    `,

    // Role Permissions
    ...protectTable("role_permissions"),
    `
      CREATE POLICY role_permissions_select ON public.role_permissions
        FOR SELECT
        USING (true);
    `,

    // Accounts
    ...protectTable("accounts"),

    // Sessions
    ...protectTable("sessions"),

    // Settings
    ...protectTable("settings"),
    `
      CREATE POLICY settings_select ON public.settings
        FOR SELECT
        -- The application filters the private settings, since only their definitions say which ones are public
        USING ((SELECT security.can_any(ARRAY['settings:read:all', 'settings:list:all', 'settings:read:public', 'settings:list:public'])));
    `,
    `
      CREATE POLICY settings_insert ON public.settings
        FOR INSERT
        WITH CHECK ((SELECT security.can_any(ARRAY['settings:create'])));
    `,
    `
      CREATE POLICY settings_update ON public.settings
        FOR UPDATE
        USING ((SELECT security.can_any(ARRAY['settings:update:all'])))
        WITH CHECK ((SELECT security.can_any(ARRAY['settings:update:all'])));
    `,
    `
      CREATE POLICY settings_delete ON public.settings
        FOR DELETE
        USING ((SELECT security.can_any(ARRAY['settings:delete:all'])));
    `,

    // Encryption keys
    ...protectTable("encryption_keys"),
  ],
};
