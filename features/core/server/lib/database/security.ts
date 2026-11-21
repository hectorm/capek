// Row-level security across features
//
// Each feature declares its resources and table policies for PostgreSQL to enforce.
//
// Transaction context
// - withUserTransaction() sets app.user_id, app.user_groups, and app.user_permissions for the current transaction.
// - A superuser connection assumes the app_rls role for user transactions. Forced policies also apply to table owners.
// - System operations such as migrations have no user ID and use the table's system policy.
// - A trusted write still has a user. Feature policies can check app.trusted_write for server-authored rows.
//
// Policy patterns
// - Use protectTable() with custom policies. sharedResourcePolicies() protects both the resource and its access table.
// - The <type>:update:all permission allows updates across shared rows of that type without an editor grant.
// - defineOwnedResource() identifies the owner column. For child rows, check the parent with isOwner().
// - defineSharedResource() identifies the access table. hasAccess() checks grants to the user and their groups.
// - The user and editor roles both allow reading or using a shared row with the corresponding permission.
// - Updating, deleting, or sharing a resource under :own requires the editor role and the corresponding permission.
// - The initial self-grant requires create permission, a row written in this transaction, and no grants to others.
//
// Writing a policy
// - Use USING to check existing rows and WITH CHECK to validate the row an insert or update would store.
// - PostgreSQL runs a transaction lookup once when a scalar subquery wraps it, e.g. (SELECT security.user_id()).
// - Use isOwner() or hasAccess() for row-dependent checks so the planner can hash the matching rows.
// - A qualified outer column, e.g. isOwner(parent, "items.parent_id"), makes the subquery check the intended row.
// - Access-table policies use security.has_access() when an inline check would recurse into the same policy.
// - When replacing grants, insert new entries before revoking old ones so an editor can finish transferring access.
//
// Installation and checks
// - After migrations, applySecurity() rebuilds policies and helpers atomically when SQL or migration names change.
// - Startup checks policy lookups, registered resource types, and forced row-level security on application tables.
// - Removing a feature leaves its tables protected. The rebuilt policy set grants no access to those rows.

import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { SharedResource } from "#layers/core/server/lib/authz/resources";
import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { PrincipalRole } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import { FALLBACK_ROLE } from "#layers/core/server/lib/database/rls";
import { assertFeaturePrefix } from "#layers/core/server/lib/features/define";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

// An owned resource records a single user's ID on each row
export interface OwnedResource {
  // Identifier passed to security.is_owner()
  readonly type: string;
  readonly table: string;
  // User ID column that records ownership
  readonly ownerColumn: string;
}

// Describe an owned table for policy generation
export const defineOwnedResource = (resource: {
  type: string;
  table: string;
  ownerColumn?: string;
}): OwnedResource => ({
  type: resource.type,
  table: resource.table,
  ownerColumn: resource.ownerColumn ?? "user_id",
});

// Feature policy builders can reference resources from any enabled feature
export interface SecurityContext {
  readonly sharedResources: readonly SharedResource[];
  readonly ownedResources: readonly OwnedResource[];
}

// A feature registers its resources and supplies the SQL for its own tables
export interface SecurityDefinition {
  // Access tables back security.has_access()
  sharedResources?: readonly SharedResource[];
  // Owner columns back security.is_owner()
  ownedResources?: readonly OwnedResource[];
  // Build feature-specific functions and policies using the combined resource registry
  statements?: (ctx: SecurityContext) => string[];
}

// Select the SQL condition for a resource type. Unknown types evaluate to FALSE
const dispatch = (cases: [type: string, condition: string][]): string => {
  if (cases.length === 0) {
    return "FALSE";
  }
  return `CASE resource_type ${cases.map(([type, condition]) => `WHEN '${type}' THEN ${condition}`).join(" ")} ELSE FALSE END`;
};

// Build the shared SQL functions that read transaction settings and check registered resources
const helperFunctions = (ctx: SecurityContext): string[] => [
  // Return the transaction's user ID, or NULL for system operations
  `
    CREATE FUNCTION security.user_id()
    RETURNS UUID
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT NULLIF(CURRENT_SETTING('app.user_id', TRUE), '')::UUID;
    $$
  `,
  // Return the transaction's group IDs for membership checks
  `
    CREATE FUNCTION security.user_groups()
    RETURNS UUID[]
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT NULLIF(CURRENT_SETTING('app.user_groups', TRUE), '')::UUID[];
    $$
  `,
  // Return the transaction's effective permission names
  `
    CREATE FUNCTION security.user_permissions()
    RETURNS TEXT[]
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT NULLIF(CURRENT_SETTING('app.user_permissions', TRUE), '')::TEXT[];
    $$
  `,
  // Check whether the server marked this user transaction as a trusted write
  `
    CREATE FUNCTION security.is_trusted_write()
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT COALESCE(CURRENT_SETTING('app.trusted_write', TRUE) = 'on', FALSE);
    $$
  `,
  // Require a user and every permission in the supplied list
  `
    CREATE FUNCTION security.can(permissions TEXT[])
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT security.user_id() IS NOT NULL AND COALESCE(permissions <@ security.user_permissions(), FALSE);
    $$
  `,
  // Require a user and at least one permission in the supplied list
  `
    CREATE FUNCTION security.can_any(permissions TEXT[])
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT security.user_id() IS NOT NULL AND COALESCE(permissions && security.user_permissions(), FALSE);
    $$
  `,
  // Check the registered owner column for the current user
  `
    CREATE FUNCTION security.is_owner(resource_type TEXT, resource_id UUID)
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT ${dispatch(
        ctx.ownedResources.map(({ type, table, ownerColumn }) => [
          type,
          `
            EXISTS (
              SELECT 1 FROM public.${table}
              WHERE id = resource_id AND ${ownerColumn} = security.user_id()
            )
          `,
        ]),
      )};
    $$
  `,
  // Check for a matching access role granted to the user or any of their groups
  `
    CREATE FUNCTION security.has_access(resource_type TEXT, resource_id UUID, required_roles TEXT[] DEFAULT ARRAY['editor', 'user'])
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT ${dispatch(
        ctx.sharedResources.map(({ type, accessTable, foreignKey }) => [
          type,
          `
            EXISTS (
              SELECT 1 FROM public.${accessTable}
              WHERE ${foreignKey} = resource_id
                AND role = ANY(required_roles)
                AND (user_id = security.user_id() OR group_id = ANY(security.user_groups()))
            )
          `,
        ]),
      )};
    $$
  `,
  // Check for any grant to a different user or to a group, including the current user's groups
  `
    CREATE FUNCTION security.has_other_access(resource_type TEXT, resource_id UUID)
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT ${dispatch(
        ctx.sharedResources.map(({ type, accessTable, foreignKey }) => [
          type,
          `
            EXISTS (
              SELECT 1 FROM public.${accessTable}
              WHERE ${foreignKey} = resource_id
                AND (user_id IS DISTINCT FROM security.user_id() OR group_id IS NOT NULL)
            )
          `,
        ]),
      )};
    $$
  `,
  // Check that this transaction wrote the row and that no other principal has a grant
  `
    CREATE FUNCTION security.is_creating(resource_type TEXT, resource_id UUID)
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    AS $$
      SELECT ${dispatch(
        ctx.sharedResources.map(({ type, table }) => [
          type,
          `
            EXISTS (
              SELECT 1 FROM public.${table}
              WHERE id = resource_id AND xmin = pg_current_xact_id_if_assigned()::xid
            )
          `,
        ]),
      )} AND NOT security.has_other_access(resource_type, resource_id);
    $$
  `,
];

// Enable and force row-level security on the table and install its system policy
export const protectTable = (table: string): string[] => [
  `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`,
  // Allow system transactions with no user ID to read and write rows
  `
    CREATE POLICY ${table}_system ON public.${table}
      USING ((SELECT security.user_id()) IS NULL)
      WITH CHECK ((SELECT security.user_id()) IS NULL);
  `,
];

// Require a table-qualified outer column so generated subqueries compare against the intended row
const assertQualified = (column: string): void => {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(column)) {
    throw new Error(`Column "${column}" must be qualified with its table, like "items.parent_id"`);
  }
};

// Build an EXISTS check against the owner of the resource referenced by the outer column
export const isOwner = (resource: OwnedResource, column: string): string => {
  assertQualified(column);
  return `
    EXISTS (
      SELECT 1 FROM public.${resource.table} own
      WHERE own.id = ${column} AND own.${resource.ownerColumn} = (SELECT security.user_id())
    )
  `;
};

// Build an EXISTS check for a user or group grant
export const hasAccess = (resource: SharedResource, column: string, roles?: readonly PrincipalRole[]): string => {
  assertQualified(column);
  return `
    EXISTS (
      SELECT 1 FROM public.${resource.accessTable} acl
      WHERE acl.${resource.foreignKey} = ${column}
      ${roles ? `AND acl.role IN (${roles.map((role) => `'${role}'`).join(", ")})` : ""}
      AND (acl.user_id = (SELECT security.user_id()) OR acl.group_id = ANY ((SELECT security.user_groups())::UUID[]))
    )
  `;
};

export type ResourceSelectAction = "read" | "list";

// Evaluate the scope of one action using the resource's own-row rule
export const selectAccess = (type: string, action: ResourceSelectAction, own: string): string => `
  (SELECT security.can_any(ARRAY['${type}:${action}:all']))
  OR ((SELECT security.can_any(ARRAY['${type}:${action}:own'])) AND (${own}))
`;

// Intersect the baseline visibility policy with the scope of an explicit read or list
export const scopedSelectPolicy = (table: string, type: string, own: string): string => `
  CREATE POLICY ${table}_select_scope ON public.${table}
    AS RESTRICTIVE FOR SELECT
    USING (
      CASE (SELECT CURRENT_SETTING('app.resource_scope', TRUE))
        WHEN '${type}:read' THEN (${selectAccess(type, "read", own)})
        WHEN '${type}:list' THEN (${selectAccess(type, "list", own)})
        ELSE TRUE
      END
    );
`;

// Check whether the target has a grant on a resource where the caller holds an editor grant directly or via a group
export const sharesResourceWith = (
  resources: readonly SharedResource[],
  principal: { userId: string } | { groupId: string },
): string => {
  const [column, value] = "userId" in principal ? ["user_id", principal.userId] : ["group_id", principal.groupId];
  if (resources.length === 0) {
    return "FALSE";
  }
  const conditions = resources.map(
    ({ accessTable, foreignKey }) => `
      EXISTS (
        SELECT 1 FROM public.${accessTable} a1
        INNER JOIN public.${accessTable} a2 ON a1.${foreignKey} = a2.${foreignKey}
        WHERE a2.${column} = ${value}
        AND a1.role = 'editor'
        AND (a1.user_id = (SELECT security.user_id()) OR a1.group_id = ANY ((SELECT security.user_groups())::UUID[]))
      )
    `,
  );
  return `(${conditions.join(" OR ")})`;
};

// Generate policies for the resource rows and the grants that control access to them
export const sharedResourcePolicies = (
  resource: SharedResource,
  options: {
    // Additional condition on the row being inserted
    insertCheck?: string;
    // Additional condition on the row after an update
    updateCheck?: string;
  } = {},
): string[] => {
  const { type, table, accessTable, foreignKey } = resource;

  // Match any listed action for this resource type using one transaction lookup
  const canAny = (...actions: string[]): string => {
    return `(SELECT security.can_any(ARRAY[${actions.map((action) => `'${type}:${action}'`).join(", ")}]))`;
  };

  // An :own update or delete requires an editor grant on the affected row
  const canEdit = (action: "update" | "delete"): string => `
    ${canAny(`${action}:all`)}
    OR (${canAny(`${action}:own`)} AND ${hasAccess(resource, `${table}.id`, ["editor"])})
  `;

  // Sharing requires update access. The SQL helper avoids an inline subquery on the access table itself
  const canShare = `
    ${canAny("update:all")}
    OR (${canAny("update:own")} AND security.has_access('${type}', ${foreignKey}, ARRAY['editor']))
  `;

  return [
    ...protectTable(table),
    // Allow :all access, :own access with a grant, or creator access while establishing the first grants
    `
      CREATE POLICY ${table}_select ON public.${table}
        FOR SELECT
        USING (
          ${canAny("read:all", "list:all", "update:all", "delete:all", "use:all")}
          OR (
            ${canAny("read:own", "list:own", "update:own", "delete:own", "use:own")}
            AND ${hasAccess(resource, `${table}.id`)}
          )
          -- A creator has to see the rows that they are creating to insert their initial self-access rows
          OR (
            ${canAny("create")}
            AND pg_current_xact_id_if_assigned() IS NOT NULL
            AND ${table}.xmin = pg_current_xact_id_if_assigned()::xid
            AND NOT security.has_other_access('${type}', ${table}.id)
          )
        );
    `,
    scopedSelectPolicy(table, type, hasAccess(resource, `${table}.id`)),
    // Require create permission and any feature-specific insert condition
    `
      CREATE POLICY ${table}_insert ON public.${table}
        FOR INSERT
        WITH CHECK (
          ${canAny("create")}
          ${options.insertCheck ? `AND (${options.insertCheck})` : ""}
        );
    `,
    // Require update access to both row versions and apply the feature check to the new values
    `
      CREATE POLICY ${table}_update ON public.${table}
        FOR UPDATE
        USING (${canEdit("update")})
        WITH CHECK (
          (${canEdit("update")})
          ${options.updateCheck ? `AND (${options.updateCheck})` : ""}
        );
    `,
    // Require delete:all, or delete:own with an editor grant on this resource
    `
      CREATE POLICY ${table}_delete ON public.${table}
        FOR DELETE
        USING (${canEdit("delete")});
    `,
    ...protectTable(accessTable),
    // Readers and updaters can inspect grants. The other :own permissions only expose the caller's own grants. Grants
    // hold only IDs and their policy does not check whether the reader can reach the resource
    `
      CREATE POLICY ${accessTable}_select ON public.${accessTable}
        FOR SELECT
        USING (
          ${canAny("read:all", "update:all", "read:own", "update:own")}
          OR (
            ${canAny("list:own", "delete:own", "use:own")}
            AND (user_id = (SELECT security.user_id()) OR group_id = ANY ((SELECT security.user_groups())::UUID[]))
          )
        );
    `,
    // Allow sharing by authorized editors, update:all holders, or creators making their initial self-grants
    `
      CREATE POLICY ${accessTable}_insert ON public.${accessTable}
        FOR INSERT
        WITH CHECK (
          ${canShare}
          -- Creators grant themselves access to a resource that they are creating while nobody else has access
          OR (
            ${canAny("create")}
            AND user_id = (SELECT security.user_id())
            AND security.is_creating('${type}', ${foreignKey})
          )
        );
    `,
    // Revoke a grant with update:all or with update:own and an editor grant on the resource
    `
      CREATE POLICY ${accessTable}_delete ON public.${accessTable}
        FOR DELETE
        USING (${canShare});
    `,
  ];
};

// Provision the fallback owner role for superuser connections and reject a role that could bypass policies
const roleStatements = (): string[] => [
  `
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      IF (SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER) THEN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${FALLBACK_ROLE}') THEN
          CREATE ROLE ${FALLBACK_ROLE} NOSUPERUSER NOBYPASSRLS;
        ELSIF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = '${FALLBACK_ROLE}') THEN
          RAISE EXCEPTION 'Role "%" already exists and bypasses row-level security', '${FALLBACK_ROLE}';
        END IF;
        IF NOT has_database_privilege('${FALLBACK_ROLE}', current_database(), 'CREATE') THEN
          EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), '${FALLBACK_ROLE}');
        END IF;
        FOR r IN
          SELECT nspname
          FROM pg_namespace
          WHERE nspname IN ('public', 'security')
          AND pg_get_userbyid(nspowner) <> '${FALLBACK_ROLE}'
        LOOP
          EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.nspname, '${FALLBACK_ROLE}');
        END LOOP;
        FOR r IN
          SELECT schemaname, tablename
          FROM pg_tables
          WHERE schemaname IN ('public', 'security') AND tablename NOT LIKE 'kysely\\_migration%'
          AND tableowner <> '${FALLBACK_ROLE}'
        LOOP
          EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', r.schemaname, r.tablename, '${FALLBACK_ROLE}');
        END LOOP;
        FOR r IN
          SELECT schemaname, sequencename
          FROM pg_sequences
          WHERE schemaname IN ('public', 'security')
          AND sequenceowner <> '${FALLBACK_ROLE}'
        LOOP
          EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', r.schemaname, r.sequencename, '${FALLBACK_ROLE}');
        END LOOP;
        FOR r IN
          SELECT p.oid::regprocedure AS sig, p.prokind
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('public', 'security') AND p.prokind IN ('f', 'p')
          AND pg_get_userbyid(p.proowner) <> '${FALLBACK_ROLE}'
        LOOP
          EXECUTE format(
            'ALTER %s %s OWNER TO %I',
            CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
            r.sig,
            '${FALLBACK_ROLE}'
          );
        END LOOP;
      END IF;
    END
    $$;
  `,
];

// Drop public policies and the shared helper schema before rebuilding them. Tables retain row-level security
const dropStatements = (): string[] => [
  `
    DO $$
    DECLARE
      policy_record RECORD;
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
    END
    $$;
  `,
  "DROP SCHEMA IF EXISTS security CASCADE",
];

// Collect one kind of resource across features and reject invalid prefixes or duplicate types
const collectResources = <R extends { type: string }>(
  features: readonly ServerFeature[],
  pick: (security: SecurityDefinition) => readonly R[] | undefined,
): R[] => {
  const types = new Set<string>();
  return features.flatMap((feature) => {
    return (feature.security ? (pick(feature.security) ?? []) : []).map((resource) => {
      if (types.has(resource.type)) {
        throw new Error(`Duplicate resource type "${resource.type}" in feature "${feature.name}"`);
      }
      assertFeaturePrefix(feature.name, resource.type, "Resource type");
      types.add(resource.type);
      return resource;
    });
  });
};

// Assemble the shared helpers and feature policies, then validate their lookups and resource references
export const composeSecurity = (features: readonly ServerFeature[]): string[] => {
  const ctx: SecurityContext = {
    sharedResources: collectResources(features, (security) => security.sharedResources),
    ownedResources: collectResources(features, (security) => security.ownedResources),
  };

  const statements = [
    "CREATE SCHEMA security",
    ...helperFunctions(ctx),
    ...features.flatMap((feature) => {
      const featureStatements = feature.security?.statements?.(ctx) ?? [];
      // Feature prefixes keep SQL function names distinct in the shared security schema
      for (const [, name] of featureStatements
        .join("\n")
        .matchAll(/CREATE (?:OR REPLACE )?FUNCTION security\.(\w+)/g)) {
        assertFeaturePrefix(feature.name, String(name), "Function");
      }
      return featureStatements;
    }),
  ];

  // Reject direct transaction lookups in policies so they can be evaluated once per statement
  for (const statement of statements) {
    const policy = /^\s*CREATE POLICY (\w+)/.exec(statement)?.[1];
    const direct =
      policy &&
      /(?<!\(SELECT )security\.(user_id|user_groups|user_permissions|is_trusted_write|can|can_any)\(/.exec(statement);
    if (direct) {
      throw new Error(
        `Policy "${policy}" must call security.${String(direct[1])}() in a subquery, like "(SELECT security.${String(direct[1])}())", so that it runs once for each statement`,
      );
    }
  }

  // Literal ownership and access checks must reference a resource registered for that kind of check
  for (const [, fn, type] of statements.join("\n").matchAll(/security\.(has_access|is_owner)\('([^']+)'/g)) {
    const resources = fn === "is_owner" ? ctx.ownedResources : ctx.sharedResources;
    if (!resources.some((resource) => resource.type === type)) {
      throw new Error(`Resource type "${String(type)}" used in security.${String(fn)}() is not registered`);
    }
  }

  return statements;
};

// Rebuild changed policies atomically and verify table protection on every startup
export const applySecurity = async (db: Kysely<Database>, features: readonly ServerFeature[]): Promise<void> => {
  const statements = composeSecurity(features);

  // Migration names enter the checksum because a migration can recreate a table and remove its policies
  const migrations = features.flatMap((feature) => {
    return Object.keys(feature.migrations ?? {}).map((name) => `${feature.name}/${name}`);
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode([...migrations, ...statements].join("\n;\n")),
  );
  const checksum = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

  const applied = await db.transaction().execute(async (trx) => {
    // The lock lets one instance apply a given policy change
    await sql`SELECT pg_advisory_xact_lock(hashtext('kysely_migration_repeatable'))`.execute(trx);

    await sql`
      CREATE TABLE IF NOT EXISTS kysely_migration_repeatable (
        name VARCHAR(255) PRIMARY KEY,
        checksum TEXT NOT NULL,
        timestamp VARCHAR(255) NOT NULL
      )
    `.execute(trx);

    const existing = await sql<{ checksum: string }>`
      SELECT checksum FROM kysely_migration_repeatable WHERE name = 'security'
    `.execute(trx);

    const changed = existing.rows[0]?.checksum !== checksum;

    if (changed) {
      logger.info("Applying row-level security");

      for (const statement of [...dropStatements(), ...statements]) {
        await sql.raw(statement).execute(trx);
      }

      await sql`
        INSERT INTO kysely_migration_repeatable (name, checksum, timestamp)
        VALUES ('security', ${checksum}, ${new Date().toISOString()})
        ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, timestamp = EXCLUDED.timestamp
      `.execute(trx);
    }

    // Require enabled and forced RLS on public tables, except migration tables and extension-owned tables
    const unprotected = await sql<{ name: string }>`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT LIKE 'kysely\\_migration%'
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
      AND NOT EXISTS (
        SELECT FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
      )
    `.execute(trx);
    if (unprotected.rows.length > 0) {
      throw new Error(`Tables without row-level security: ${unprotected.rows.map((row) => row.name).join(", ")}`);
    }

    // Reconcile the fallback role on every run so it also owns objects added since the last policy change
    for (const statement of roleStatements()) {
      await sql.raw(statement).execute(trx);
    }

    return changed;
  });

  if (applied) {
    logger.info("Row-level security applied");
  }
};
