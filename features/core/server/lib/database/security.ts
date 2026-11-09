// =============================================================================
// Row Level Security
// =============================================================================
//
// The row level security of all features is composed into one set of statements, recreated whenever it or the migrations change.
//
// HOW IT WORKS:
// -------------
// 1. Application sets session variables via withUserTransaction():
//    - app.user_id: Current user's UUID
//    - app.user_groups: Array of group UUIDs the user belongs to
//    - app.user_permissions: Array of permission strings (e.g., 'user:read:own')
//
// 2. Helper functions read these variables:
//    - security.user_id(): Returns current user ID (NULL for system operations)
//    - security.user_groups(): Returns user's group memberships
//    - security.user_permissions(): Returns the current user's permissions
//    - security.can()/security.can_any(): Check whether required permissions are present
//    - security.is_owner(): Checks ownership of the owned resources registered by features
//    - security.has_access(): Checks access granted through the access tables of shared resources
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
//   - ':all' permissions (e.g., 'user:read:all') grant access to ALL rows
//   - ':own' permissions (e.g., 'user:read:own') require additional ownership checks
//
// Ownership via access tables:
//   Shared resources (see defineSharedResource) use access tables to track who has access. Two roles exist:
//   - 'editor': Can update, delete, and grant access to others
//   - 'user': Can read and execute (use) the resource
//
// Access can be granted to:
//   - Individual users (user_id column)
//   - Groups (group_id column), all group members inherit access
//
// Tables of removed features keep row level security enabled without policies, so they become inaccessible.
//
// =============================================================================

import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { SharedResource } from "#layers/core/server/lib/authz/resources";
import type { ServerFeature } from "#layers/core/server/lib/features/define";
import type { Database } from "#layers/core/shared/schema";
import { FALLBACK_ROLE } from "#layers/core/server/lib/database/rls";
import { assertFeaturePrefix } from "#layers/core/server/lib/features/define";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

// Resource owned by a single user, checked by `security.is_owner()`
export interface OwnedResource {
  // Resource type, as passed to `security.is_owner()`
  readonly type: string;
  readonly table: string;
  // Column holding the ID of the owner user
  readonly ownerColumn: string;
}

export const defineOwnedResource = (resource: {
  type: string;
  table: string;
  ownerColumn?: string;
}): OwnedResource => ({
  type: resource.type,
  table: resource.table,
  ownerColumn: resource.ownerColumn ?? "user_id",
});

export interface SecurityContext {
  // Shared resources registered by all features
  readonly sharedResources: readonly SharedResource[];
  // Owned resources registered by all features
  readonly ownedResources: readonly OwnedResource[];
}

export interface SecurityDefinition {
  // Resources shared through access tables, checked by `security.has_access()`
  sharedResources?: readonly SharedResource[];
  // Resources owned by a single user, checked by `security.is_owner()`
  ownedResources?: readonly OwnedResource[];
  // SQL statements that create the functions and policies of the feature
  statements?: (ctx: SecurityContext) => string[];
}

// Enables row level security on a table, allowing system operations
export const protectTable = (table: string): string[] => [
  `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`,
  `
    CREATE POLICY ${table}_system ON public.${table}
      USING (security.user_id() IS NULL)
      WITH CHECK (security.user_id() IS NULL);
  `,
];

// Lets editors see the users and groups they share resources with
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
        AND (a1.user_id = security.user_id() OR a1.group_id = ANY(security.user_groups()))
      )
    `,
  );
  return `(${conditions.join(" OR ")})`;
};

// Policies of a shared resource and its access table
export const sharedResourcePolicies = (
  resource: SharedResource,
  options: {
    // Additional condition required to insert a resource
    insertCheck?: string;
    // Additional condition required to update a resource
    updateCheck?: string;
  } = {},
): string[] => {
  const { type, table, accessTable, foreignKey } = resource;

  const canUpdate = `
    security.can_any(ARRAY['${type}:update:all'])
    OR (security.can_any(ARRAY['${type}:update:own']) AND security.has_access('${type}', id, ARRAY['editor']))
  `;

  return [
    ...protectTable(table),
    `
      CREATE POLICY ${table}_select ON public.${table}
        FOR SELECT
        USING (
          security.can_any(ARRAY['${type}:read:all', '${type}:list:all', '${type}:update:all', '${type}:delete:all', '${type}:use:all'])
          OR (
            security.can_any(ARRAY['${type}:read:own', '${type}:list:own', '${type}:update:own', '${type}:delete:own', '${type}:use:own'])
            AND security.has_access('${type}', id)
          )
          -- Let creators see rows in the current transaction with no access grants
          -- to other users or groups so they can insert their initial self-access rows
          OR (
            security.can_any(ARRAY['${type}:create'])
            AND age(${table}.xmin) = 0
            AND NOT EXISTS (
              SELECT 1 FROM public.${accessTable} a
              WHERE a.${foreignKey} = ${table}.id
              AND (a.user_id IS DISTINCT FROM security.user_id() OR a.group_id IS NOT NULL)
            )
          )
        );
    `,
    `
      CREATE POLICY ${table}_insert ON public.${table}
        FOR INSERT
        WITH CHECK (
          security.can_any(ARRAY['${type}:create'])
          ${options.insertCheck ? `AND (${options.insertCheck})` : ""}
        );
    `,
    `
      CREATE POLICY ${table}_update ON public.${table}
        FOR UPDATE
        USING (${canUpdate})
        WITH CHECK (
          (${canUpdate})
          ${options.updateCheck ? `AND (${options.updateCheck})` : ""}
        );
    `,
    `
      CREATE POLICY ${table}_delete ON public.${table}
        FOR DELETE
        USING (
          security.can_any(ARRAY['${type}:delete:all'])
          OR (security.can_any(ARRAY['${type}:delete:own']) AND security.has_access('${type}', id, ARRAY['editor']))
        );
    `,
    ...protectTable(accessTable),
    // Doesn't filter by resource access to avoid RLS recursion (has_access queries this table).
    // Users with :own permissions can see access metadata for all resources, but not resource content.
    `
      CREATE POLICY ${accessTable}_select ON public.${accessTable}
        FOR SELECT
        USING (
          security.can_any(ARRAY['${type}:read:all', '${type}:update:all', '${type}:read:own', '${type}:update:own'])
        );
    `,
    `
      CREATE POLICY ${accessTable}_insert ON public.${accessTable}
        FOR INSERT
        WITH CHECK (
          security.can_any(ARRAY['${type}:update:all'])
          OR (security.can_any(ARRAY['${type}:update:own']) AND security.has_access('${type}', ${foreignKey}, ARRAY['editor']))
          -- Implicit creator self-grant: creator can grant access to themselves only for resources
          -- created in the current transaction, and only when no other users or groups have access
          OR (
            security.can_any(ARRAY['${type}:create'])
            AND user_id = security.user_id()
            AND EXISTS (
              SELECT 1 FROM public.${table} r
              WHERE r.id = ${accessTable}.${foreignKey}
              AND age(r.xmin) = 0
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.${accessTable} a
              WHERE a.${foreignKey} = ${accessTable}.${foreignKey}
              AND (a.user_id IS DISTINCT FROM security.user_id() OR a.group_id IS NOT NULL)
            )
          )
        );
    `,
    `
      CREATE POLICY ${accessTable}_delete ON public.${accessTable}
        FOR DELETE
        USING (
          security.can_any(ARRAY['${type}:update:all'])
          OR (security.can_any(ARRAY['${type}:update:own']) AND security.has_access('${type}', ${foreignKey}, ARRAY['editor']))
        );
    `,
  ];
};

const helperFunctions = (ctx: SecurityContext): string[] => [
  // Function to get user ID from session variable
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
  // Function to get user group IDs from session variable
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
  // Function to get user permissions from session variable
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
  // Function to check if user has ALL permissions from the list
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
  // Function to check if user has ANY permission from the list
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
  // Function to check if user owns a resource with direct user ownership
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
  // Function to check if user has direct access to a shared resource via access tables
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
];

// Expression that evaluates the condition of the matching resource type
const dispatch = (cases: [type: string, condition: string][]): string => {
  if (cases.length === 0) {
    return "FALSE";
  }
  return `CASE resource_type ${cases.map(([type, condition]) => `WHEN '${type}' THEN ${condition}`).join(" ")} ELSE FALSE END`;
};

// Provisions the role superuser connections de-escalate to, which accesses all objects as their owner, writing only what differs
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
          RAISE EXCEPTION 'Role "%" already exists and bypasses row level security', '${FALLBACK_ROLE}';
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

// Drops the security schema and all public policies, keeping row level security enabled
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

// Rejects duplicated types, which the security functions would silently ignore
const collectResources = <R extends { type: string }>(
  features: readonly ServerFeature[],
  pick: (security: SecurityDefinition) => readonly R[] | undefined,
): R[] => {
  const types = new Set<string>();
  return features.flatMap((feature) =>
    (feature.security ? (pick(feature.security) ?? []) : []).map((resource) => {
      if (types.has(resource.type)) {
        throw new Error(`Duplicate resource type "${resource.type}" in feature "${feature.name}"`);
      }
      assertFeaturePrefix(feature.name, resource.type, "Resource type");
      types.add(resource.type);
      return resource;
    }),
  );
};

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
      for (const [, name] of featureStatements
        .join("\n")
        .matchAll(/CREATE (?:OR REPLACE )?FUNCTION security\.(\w+)/g)) {
        assertFeaturePrefix(feature.name, String(name), "Function");
      }
      return featureStatements;
    }),
  ];

  for (const [, fn, type] of statements.join("\n").matchAll(/security\.(has_access|is_owner)\('([^']+)'/g)) {
    const resources = fn === "is_owner" ? ctx.ownedResources : ctx.sharedResources;
    if (!resources.some((resource) => resource.type === type)) {
      throw new Error(`Resource type "${String(type)}" used in security.${String(fn)}() is not registered`);
    }
  }

  return statements;
};

// Applies the security statements when they differ from the last applied ones
export const applySecurity = async (db: Kysely<Database>, features: readonly ServerFeature[]): Promise<void> => {
  const statements = composeSecurity(features);

  // Migrations are part of the checksum, since a recreated table loses its policies
  const migrations = features.flatMap((feature) =>
    Object.keys(feature.migrations ?? {}).map((name) => `${feature.name}/${name}`),
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode([...migrations, ...statements].join("\n;\n")),
  );
  const checksum = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

  const applied = await db.transaction().execute(async (trx) => {
    // Serializes concurrent instances, so the statements are applied only once
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
      logger.info("Applying row level security");

      for (const statement of [...dropStatements(), ...statements]) {
        await sql.raw(statement).execute(trx);
      }

      await sql`
        INSERT INTO kysely_migration_repeatable (name, checksum, timestamp)
        VALUES ('security', ${checksum}, ${new Date().toISOString()})
        ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, timestamp = EXCLUDED.timestamp
      `.execute(trx);
    }

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
      throw new Error(`Tables without row level security: ${unprotected.rows.map((row) => row.name).join(", ")}`);
    }

    // Always provisioned, since it depends on the connection and the existing objects rather than on the checksum
    for (const statement of roleStatements()) {
      await sql.raw(statement).execute(trx);
    }

    return changed;
  });

  if (applied) {
    logger.info("Row level security applied");
  }
};
