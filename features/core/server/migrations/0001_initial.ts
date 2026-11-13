import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "#layers/core/shared/schema";
import { naturalCollation } from "#layers/core/server/lib/database/schema";

export const up = async (db: Kysely<Database>): Promise<void> => {
  const icu = await sql<{ oid: number }>`
    SELECT oid FROM pg_collation WHERE collname = 'und-x-icu' AND collprovider = 'i' LIMIT 1
  `.execute(db);

  if (icu.rows.length > 0) {
    await sql`CREATE COLLATION natural_cs (
      PROVIDER = 'icu',
      LOCALE = 'und-u-kn-true-ks-level3',
      DETERMINISTIC = TRUE
    )`.execute(db);
  }

  const naturalCs = await naturalCollation(db);

  ////////////////////////////////

  await db.schema
    .createTable("public.users")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("username", sql`varchar(255) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("fullname", sql`varchar(255) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("email", sql`varchar(255) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("picture", sql`text COLLATE "C"`)
    .addColumn("lastLoginAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("usersFullnameIdIdx").on("public.users").columns(["fullname", "id"]).execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.groups")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(255) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("description", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.roles")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(255) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.permissions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(255) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.userGroups")
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade").notNull())
    .addColumn("groupId", "uuid", (col) => col.references("public.groups.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("userGroupsPk", ["userId", "groupId"])
    .execute();

  await db.schema.createIndex("userGroupsGroupIdIdx").on("public.userGroups").column("groupId").execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.userRoles")
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade").notNull())
    .addColumn("roleId", "uuid", (col) => col.references("public.roles.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("userRolesPk", ["userId", "roleId"])
    .execute();

  await db.schema.createIndex("userRolesRoleIdIdx").on("public.userRoles").column("roleId").execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.groupRoles")
    .addColumn("groupId", "uuid", (col) => col.references("public.groups.id").onDelete("cascade").notNull())
    .addColumn("roleId", "uuid", (col) => col.references("public.roles.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("groupRolesPk", ["groupId", "roleId"])
    .execute();

  await db.schema.createIndex("groupRolesRoleIdIdx").on("public.groupRoles").column("roleId").execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.rolePermissions")
    .addColumn("roleId", "uuid", (col) => col.references("public.roles.id").onDelete("cascade").notNull())
    .addColumn("permissionId", "uuid", (col) => col.references("public.permissions.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("rolePermissionsPk", ["roleId", "permissionId"])
    .execute();

  await db.schema
    .createIndex("rolePermissionsPermissionIdIdx")
    .on("public.rolePermissions")
    .column("permissionId")
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.accounts")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade").notNull())
    .addColumn("iss", sql`text COLLATE "C"`, (col) => col.notNull())
    .addColumn("sub", sql`text COLLATE "C"`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("accountsUserIdIdx").on("public.accounts").column("userId").execute();

  await db.schema.createIndex("accountsIssSubIdx").unique().on("public.accounts").columns(["iss", "sub"]).execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.sessions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade").notNull())
    .addColumn("token", sql`varchar(48) COLLATE "C"`, (col) => col.notNull().unique())
    .addColumn("sid", sql`varchar(255) COLLATE "C"`)
    .addColumn("idToken", sql`text COLLATE "C"`)
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("expiresAt", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema.createIndex("sessionsUserIdIdx").on("public.sessions").column("userId").execute();

  await db.schema.createIndex("sessionsSidIdx").on("public.sessions").column("sid").execute();

  await db.schema.createIndex("sessionsExpiresAtIdx").on("public.sessions").column("expiresAt").execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.settings")
    .addColumn("key", sql`varchar(255) COLLATE "C"`, (col) => col.primaryKey())
    .addColumn("value", "jsonb")
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.encryptionKeys")
    .addColumn("version", "integer", (col) => col.primaryKey())
    .addColumn("wrappedKey", sql`text COLLATE "C"`, (col) => col.notNull())
    .addColumn("mainKeyFingerprint", sql`varchar(43) COLLATE "C"`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();
};
