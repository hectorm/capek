import type { SecurityDefinition } from "#layers/core/server/lib/database/security";
import { protectTable, sharesResourceWith } from "#layers/core/server/lib/database/security";

export const coreSecurity: SecurityDefinition = {
  statements: (ctx) => [
    // Users
    ...protectTable("users"),
    `
      CREATE POLICY users_select ON public.users
        FOR SELECT
        USING (
          (SELECT security.can_any(ARRAY['user:read:all', 'user:list:all']))
          OR (id = (SELECT security.user_id()) AND (SELECT security.can_any(ARRAY['user:read:own'])))
          -- Implicit: editors can see users with whom they share resource access
          OR ${sharesResourceWith(ctx.sharedResources, { userId: "users.id" })}
        );
    `,
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
            AND EXISTS (
              SELECT 1 FROM public.user_groups
              WHERE user_groups.group_id = groups.id
              AND user_groups.user_id = (SELECT security.user_id())
            )
          )
          -- Implicit: editors can see groups with whom they share resource access
          OR ${sharesResourceWith(ctx.sharedResources, { groupId: "groups.id" })}
        );
    `,
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
        -- Note: public vs private filtering is handled at application level
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
