import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Principal, PrincipalAccess, PrincipalRole } from "#layers/core/shared/rbac";
import type { Database } from "#layers/core/shared/schema";
import { RLSViolationError } from "#layers/core/server/lib/database/errors";

// Resource shared with users and groups through an access table, as "editor" (manage) or "user" (read and use)
export interface SharedResource {
  // Resource type, used as permission prefix (e.g. `<type>:read:own`) and by `security.has_access()`
  readonly type: string;
  readonly table: string;
  readonly accessTable: string;
  // Access table column referencing the resource
  readonly foreignKey: string;
  // Column with the name that identifies each resource
  readonly nameColumn: string;
}

export const defineSharedResource = (resource: {
  type: string;
  table: string;
  accessTable?: string;
  foreignKey?: string;
  nameColumn?: string;
}): SharedResource => ({
  type: resource.type,
  table: resource.table,
  accessTable: resource.accessTable ?? `${resource.type}_access`,
  foreignKey: resource.foreignKey ?? `${resource.type}_id`,
  nameColumn: resource.nameColumn ?? "name",
});

export interface ResourceName {
  id: string;
  name: string;
}

// Resources by ID, name or search, among the ones that the database connection can read
export const listResources = async (
  db: Kysely<Database>,
  resource: SharedResource,
  filter: { ids: readonly string[] } | { names: readonly string[] } | { search?: string; limit: number },
): Promise<ResourceName[]> => {
  const name = sql.ref(resource.nameColumn);

  let condition = sql`TRUE`;
  let limit = sql``;
  if ("ids" in filter || "names" in filter) {
    const values = "ids" in filter ? filter.ids : filter.names;
    if (values.length === 0) {
      return [];
    }
    condition = sql`${"ids" in filter ? sql.ref("id") : name} IN (${sql.join(values)})`;
  } else {
    if (filter.search) {
      condition = sql`${name} ILIKE ${`%${filter.search}%`}`;
    }
    limit = sql`LIMIT ${filter.limit}`;
  }

  const result = await sql<ResourceName>`
    SELECT id, ${name} AS name
    FROM ${sql.table(resource.table)}
    WHERE ${condition}
    ORDER BY ${name}, id
    ${limit}
  `.execute(db);
  return result.rows;
};

// IDs of the given resources that the user of the transaction can use
export const usableResourceIds = async (
  db: Kysely<Database>,
  resource: SharedResource,
  ids: readonly string[],
): Promise<string[]> => {
  if (ids.length === 0) {
    return [];
  }

  const result = await sql<{ id: string }>`
    SELECT id FROM unnest(ARRAY[${sql.join(ids)}]::UUID[]) AS id
    WHERE security.can_any(ARRAY[${`${resource.type}:use:all`}])
    OR (security.can_any(ARRAY[${`${resource.type}:use:own`}]) AND security.has_access(${resource.type}, id))
  `.execute(db);
  return result.rows.map((row) => row.id);
};

const accessKey = (access: PrincipalAccess): string => `${access.type}:${access.id.toLowerCase()}:${access.role}`;

export const listResourceAccess = async (
  db: Kysely<Database>,
  resource: SharedResource,
  resourceId: string,
): Promise<Principal[]> => {
  const result = await sql<{
    userId: string | null;
    groupId: string | null;
    role: PrincipalRole;
    username: string | null;
    email: string | null;
    groupname: string | null;
  }>`
    SELECT a.user_id, a.group_id, a.role, u.username, u.email, g.name AS groupname
    FROM ${sql.table(resource.accessTable)} AS a
    LEFT JOIN users AS u ON u.id = a.user_id
    LEFT JOIN groups AS g ON g.id = a.group_id
    WHERE ${sql.ref(`a.${resource.foreignKey}`)} = ${resourceId}
  `.execute(db);

  const principals: Principal[] = [];
  for (const a of result.rows) {
    if (a.userId !== null && a.username !== null && a.email !== null) {
      principals.push({ id: a.userId, type: "user", role: a.role, username: a.username, email: a.email });
    } else if (a.groupId !== null && a.groupname !== null) {
      principals.push({ id: a.groupId, type: "group", role: a.role, groupname: a.groupname });
    }
  }

  return principals;
};

export const grantResourceAccess = async (
  db: Kysely<Database>,
  resource: SharedResource,
  resourceId: string,
  access: readonly PrincipalAccess[],
  options: { ignoreDuplicates?: boolean } = {},
): Promise<void> => {
  if (access.length === 0) {
    return;
  }

  await sql`
    INSERT INTO ${sql.table(resource.accessTable)} (${sql.ref(resource.foreignKey)}, user_id, group_id, role)
    VALUES ${sql.join(
      access.map(
        (a) => sql`(${resourceId}, ${a.type === "user" ? a.id : null}, ${a.type === "group" ? a.id : null}, ${a.role})`,
      ),
    )}
    ${options.ignoreDuplicates ? sql`ON CONFLICT DO NOTHING` : sql``}
  `.execute(db);
};

export const revokeResourceAccess = async (
  db: Kysely<Database>,
  resource: SharedResource,
  resourceId: string,
  access: readonly PrincipalAccess[],
): Promise<void> => {
  if (access.length === 0) {
    return;
  }

  const result = await sql`
    DELETE FROM ${sql.table(resource.accessTable)}
    WHERE ${sql.ref(resource.foreignKey)} = ${resourceId}
    AND (${sql.join(
      access.map((a) => {
        return a.type === "user"
          ? sql`(user_id = ${a.id} AND role = ${a.role})`
          : sql`(group_id = ${a.id} AND role = ${a.role})`;
      }),
      sql` OR `,
    )})
  `.execute(db);

  if (Number(result.numAffectedRows ?? 0) < access.length) {
    throw new RLSViolationError(`Access to ${resource.type} "${resourceId}" could not be revoked`);
  }
};

// Replaces the access entries of a resource with the given ones
export const syncResourceAccess = async (
  db: Kysely<Database>,
  resource: SharedResource,
  resourceId: string,
  access: readonly PrincipalAccess[],
): Promise<{ added: number; removed: number }> => {
  const result = await sql<{ userId: string | null; groupId: string | null; role: PrincipalRole }>`
    SELECT user_id, group_id, role
    FROM ${sql.table(resource.accessTable)}
    WHERE ${sql.ref(resource.foreignKey)} = ${resourceId}
  `.execute(db);

  const current = result.rows.map((c): PrincipalAccess => {
    return c.userId !== null
      ? { id: c.userId, type: "user", role: c.role }
      : { id: c.groupId ?? "", type: "group", role: c.role };
  });

  const currentKeys = new Set(current.map(accessKey));
  const targetKeys = new Set(access.map(accessKey));

  const toAdd = access.filter((a) => !currentKeys.has(accessKey(a)));
  const toRemove = current.filter((c) => !targetKeys.has(accessKey(c)));

  // Grant first, so the policies check the editor access held before the change
  await grantResourceAccess(db, resource, resourceId, toAdd);
  await revokeResourceAccess(db, resource, resourceId, toRemove);

  return { added: toAdd.length, removed: toRemove.length };
};
