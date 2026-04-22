import type { Kysely, RawBuilder } from "kysely";
import { sql } from "kysely";

import type { Database } from "~~/shared/schema";

interface DatabaseWithPgCollation extends Database {
  pgCollation: {
    oid: number;
    collname: string;
    collprovider: "c" | "i";
  };
}

export const up = async (db: Kysely<DatabaseWithPgCollation>): Promise<void> => {
  const icu = await db
    .selectFrom("pgCollation")
    .select("oid")
    .where("collname", "=", "und-x-icu")
    .where("collprovider", "=", "i")
    .limit(1)
    .executeTakeFirst();

  let naturalCs: RawBuilder<unknown>;
  if (icu) {
    naturalCs = sql.raw("natural_cs");
    await sql`CREATE COLLATION natural_cs (
      PROVIDER = 'icu',
      LOCALE = 'und-u-kn-true-ks-level3',
      DETERMINISTIC = TRUE
    )`.execute(db);
  } else {
    naturalCs = sql.raw(`"default"`);
  }

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
    .createTable("public.chatSessions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade").notNull())
    .addColumn("agentId", "uuid")
    .addColumn("title", sql`varchar(500) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("chatSessionsUserIdUpdatedAtIdx")
    .on("public.chatSessions")
    .columns(["userId", "updatedAt"])
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.chatMessages")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("sessionId", "uuid", (col) => col.references("public.chatSessions.id").onDelete("cascade").notNull())
    .addColumn("role", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("content", sql`text COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("chatMessagesSessionIdCreatedAtIdx")
    .on("public.chatMessages")
    .columns(["sessionId", "createdAt"])
    .execute();

  await db.schema
    .createIndex("chatMessagesSessionRoleCreatedIdx")
    .on("public.chatMessages")
    .columns(["sessionId", "role", "createdAt"])
    .where(sql.ref("role"), "!=", sql.lit("app"))
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.chatSessionVfs")
    .addColumn("sessionId", "uuid", (col) => col.primaryKey().references("public.chatSessions.id").onDelete("cascade"))
    .addColumn("data", sql`bytea`, (col) => col.notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.llmProviders")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("description", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("apiUrl", sql`text COLLATE "C"`, (col) => col.notNull())
    .addColumn("apiKey", sql`text COLLATE "C"`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("headers", "jsonb", (col) => col.defaultTo(sql`'[]'::jsonb`).notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("llmProvidersNameIdx").on("public.llmProviders").column("name").execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.llmProviderAccess")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("llmProviderId", "uuid", (col) => col.references("public.llmProviders.id").onDelete("cascade").notNull())
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade"))
    .addColumn("groupId", "uuid", (col) => col.references("public.groups.id").onDelete("cascade"))
    .addColumn("role", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("llmProviderAccessUserIdIdx")
    .on("public.llmProviderAccess")
    .column("userId")
    .where(sql.ref("userId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("llmProviderAccessGroupIdIdx")
    .on("public.llmProviderAccess")
    .column("groupId")
    .where(sql.ref("groupId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("llmProviderAccessUniqueUser")
    .on("public.llmProviderAccess")
    .columns(["llmProviderId", "userId", "role"])
    .where(sql.ref("userId"), "is not", null)
    .unique()
    .execute();

  await db.schema
    .createIndex("llmProviderAccessUniqueGroup")
    .on("public.llmProviderAccess")
    .columns(["llmProviderId", "groupId", "role"])
    .where(sql.ref("groupId"), "is not", null)
    .unique()
    .execute();

  await db.schema
    .alterTable("public.llmProviderAccess")
    .addCheckConstraint(
      "llm_provider_access_user_or_group",
      sql`(user_id IS NOT NULL AND group_id IS NULL) OR (user_id IS NULL AND group_id IS NOT NULL)`,
    )
    .execute();

  await db.schema
    .alterTable("public.llmProviderAccess")
    .addCheckConstraint("llm_provider_access_role_check", sql`role IN ('editor', 'user')`)
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.mcpServers")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("description", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("url", sql`text COLLATE "C"`, (col) => col.notNull())
    .addColumn("headers", "jsonb", (col) => col.defaultTo(sql`'[]'::jsonb`).notNull())
    .addColumn("stateful", "boolean", (col) => col.defaultTo(sql`false`).notNull())
    .addColumn("toolCallTimeoutSec", "integer")
    .addColumn("cachedTools", "jsonb", (col) => col.defaultTo(sql`'[]'::jsonb`).notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("mcpServersNameIdx").on("public.mcpServers").column("name").execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.mcpServerAccess")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("mcpServerId", "uuid", (col) => col.references("public.mcpServers.id").onDelete("cascade").notNull())
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade"))
    .addColumn("groupId", "uuid", (col) => col.references("public.groups.id").onDelete("cascade"))
    .addColumn("role", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("mcpServerAccessUserIdIdx")
    .on("public.mcpServerAccess")
    .column("userId")
    .where(sql.ref("userId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("mcpServerAccessGroupIdIdx")
    .on("public.mcpServerAccess")
    .column("groupId")
    .where(sql.ref("groupId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("mcpServerAccessUniqueUser")
    .on("public.mcpServerAccess")
    .columns(["mcpServerId", "userId", "role"])
    .where(sql.ref("userId"), "is not", null)
    .unique()
    .execute();

  await db.schema
    .createIndex("mcpServerAccessUniqueGroup")
    .on("public.mcpServerAccess")
    .columns(["mcpServerId", "groupId", "role"])
    .where(sql.ref("groupId"), "is not", null)
    .unique()
    .execute();

  await db.schema
    .alterTable("public.mcpServerAccess")
    .addCheckConstraint(
      "mcp_server_access_user_or_group_check",
      sql`(user_id IS NOT NULL AND group_id IS NULL) OR (user_id IS NULL AND group_id IS NOT NULL)`,
    )
    .execute();

  await db.schema
    .alterTable("public.mcpServerAccess")
    .addCheckConstraint("mcp_server_access_role_check", sql`role IN ('editor', 'user')`)
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.skills")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("description", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("documentation", sql`text COLLATE ${naturalCs}`)
    .addColumn("parameters", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'{"type": "object", "properties": {}, "required": []}'::jsonb`),
    )
    .addColumn("code", sql`text COLLATE ${naturalCs}`)
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("skillsNameIdx").on("public.skills").column("name").execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.skillAccess")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("skillId", "uuid", (col) => col.references("public.skills.id").onDelete("cascade").notNull())
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade"))
    .addColumn("groupId", "uuid", (col) => col.references("public.groups.id").onDelete("cascade"))
    .addColumn("role", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("skillAccessUserIdIdx")
    .on("public.skillAccess")
    .column("userId")
    .where(sql.ref("userId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("skillAccessGroupIdIdx")
    .on("public.skillAccess")
    .column("groupId")
    .where(sql.ref("groupId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("skillAccessUniqueUser")
    .on("public.skillAccess")
    .columns(["skillId", "userId", "role"])
    .where(sql.ref("userId"), "is not", null)
    .unique()
    .execute();

  await db.schema
    .createIndex("skillAccessUniqueGroup")
    .on("public.skillAccess")
    .columns(["skillId", "groupId", "role"])
    .where(sql.ref("groupId"), "is not", null)
    .unique()
    .execute();

  await db.schema
    .alterTable("public.skillAccess")
    .addCheckConstraint(
      "skill_access_user_or_group_check",
      sql`(user_id IS NOT NULL AND group_id IS NULL) OR (user_id IS NULL AND group_id IS NOT NULL)`,
    )
    .execute();

  await db.schema
    .alterTable("public.skillAccess")
    .addCheckConstraint("skill_access_role_check", sql`role IN ('editor', 'user')`)
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.agents")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("description", sql`varchar(500) COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("instructions", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("greetingMessage", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("type", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("llmProviderId", "uuid", (col) => col.references("public.llmProviders.id").onDelete("restrict"))
    .addColumn("model", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("summaryModel", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("codeInterpreter", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("streaming", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("temperature", "real")
    .addColumn("maxTokens", "integer")
    .addColumn("topP", "real")
    .addColumn("frequencyPenalty", "real")
    .addColumn("presencePenalty", "real")
    .addColumn("maxIterations", "integer")
    .addColumn("timeoutSec", "integer")
    .addColumn("maxContextChars", "integer")
    .addColumn("maxToolResponseChars", "integer")
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("agentsNameIdx").on("public.agents").column("name").execute();

  await db.schema.createIndex("agentsTypeIdx").on("public.agents").column("type").execute();

  await db.schema
    .createIndex("agentsLlmProviderIdIdx")
    .on("public.agents")
    .column("llmProviderId")
    .where(sql.ref("llmProviderId"), "is not", null)
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.agentAccess")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("agentId", "uuid", (col) => col.references("public.agents.id").onDelete("cascade").notNull())
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade"))
    .addColumn("groupId", "uuid", (col) => col.references("public.groups.id").onDelete("cascade"))
    .addColumn("role", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("agentAccessUserIdIdx")
    .on("public.agentAccess")
    .column("userId")
    .where(sql.ref("userId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("agentAccessGroupIdIdx")
    .on("public.agentAccess")
    .column("groupId")
    .where(sql.ref("groupId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("agentAccessUniqueUser")
    .on("public.agentAccess")
    .columns(["agentId", "userId", "role"])
    .where(sql.ref("userId"), "is not", null)
    .unique()
    .execute();

  await db.schema
    .createIndex("agentAccessUniqueGroup")
    .on("public.agentAccess")
    .columns(["agentId", "groupId", "role"])
    .where(sql.ref("groupId"), "is not", null)
    .unique()
    .execute();

  await db.schema
    .alterTable("public.agentAccess")
    .addCheckConstraint(
      "agent_access_user_or_group_check",
      sql`(user_id IS NOT NULL AND group_id IS NULL) OR (user_id IS NULL AND group_id IS NOT NULL)`,
    )
    .execute();

  await db.schema
    .alterTable("public.agentAccess")
    .addCheckConstraint("agent_access_role_check", sql`role IN ('editor', 'user')`)
    .execute();

  await db.schema
    .alterTable("public.agents")
    .addCheckConstraint("agents_type_check", sql`type IN ('triage', 'specialist')`)
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.agentMcpServers")
    .addColumn("agentId", "uuid", (col) => col.references("public.agents.id").onDelete("cascade").notNull())
    .addColumn("mcpServerId", "uuid", (col) => col.references("public.mcpServers.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("agentMcpServersPk", ["agentId", "mcpServerId"])
    .execute();

  await db.schema
    .createIndex("agentMcpServersServerIdIdx")
    .on("public.agentMcpServers")
    .column("mcpServerId")
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.agentSkills")
    .addColumn("agentId", "uuid", (col) => col.references("public.agents.id").onDelete("cascade").notNull())
    .addColumn("skillId", "uuid", (col) => col.references("public.skills.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("agentSkillsPk", ["agentId", "skillId"])
    .execute();

  await db.schema.createIndex("agentSkillsSkillIdIdx").on("public.agentSkills").column("skillId").execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.triageSpecialists")
    .addColumn("triageAgentId", "uuid", (col) => col.references("public.agents.id").onDelete("cascade").notNull())
    .addColumn("specialistAgentId", "uuid", (col) => col.references("public.agents.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("triageSpecialistsPk", ["triageAgentId", "specialistAgentId"])
    .execute();

  await db.schema
    .createIndex("triageSpecialistsSpecialistIdIdx")
    .on("public.triageSpecialists")
    .column("specialistAgentId")
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.agentExecutions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("sessionId", "uuid", (col) => col.references("public.chatSessions.id").onDelete("set null"))
    .addColumn("agentId", "uuid", (col) => col.references("public.agents.id").onDelete("set null"))
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("set null"))
    .addColumn("status", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo("pending"))
    .addColumn("inputMessageId", "uuid", (col) => col.references("public.chatMessages.id").onDelete("set null"))
    .addColumn("outputMessageId", "uuid", (col) => col.references("public.chatMessages.id").onDelete("set null"))
    .addColumn("startedAt", "timestamptz")
    .addColumn("lastActivityAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("completedAt", "timestamptz")
    .addColumn("errorMessage", sql`text COLLATE ${naturalCs}`)
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("agentExecutionsSessionIdIdx").on("public.agentExecutions").column("sessionId").execute();

  await db.schema.createIndex("agentExecutionsAgentIdIdx").on("public.agentExecutions").column("agentId").execute();

  await db.schema
    .createIndex("agentExecutionsUserStatusCreatedIdx")
    .on("public.agentExecutions")
    .columns(["userId", "status", "createdAt"])
    .where(sql.ref("userId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("agentExecutionsStatusLastActivityAtIdx")
    .on("public.agentExecutions")
    .columns(["status", "lastActivityAt"])
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.agentCodeExecutions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("executionId", "uuid", (col) => col.references("public.agentExecutions.id").onDelete("set null"))
    .addColumn("code", sql`text COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("reasoning", sql`text COLLATE ${naturalCs}`)
    .addColumn("result", "jsonb")
    .addColumn("logs", "jsonb")
    .addColumn("errorMessage", sql`text COLLATE ${naturalCs}`)
    .addColumn("executionMs", "integer", (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("agentCodeExecutionsExecutionIdIdx")
    .on("public.agentCodeExecutions")
    .column("executionId")
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.agentToolCalls")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("executionId", "uuid", (col) => col.references("public.agentExecutions.id").onDelete("set null"))
    .addColumn("mcpServerId", "uuid", (col) => col.references("public.mcpServers.id").onDelete("set null"))
    .addColumn("skillId", "uuid", (col) => col.references("public.skills.id").onDelete("set null"))
    .addColumn("codeExecutionId", "uuid", (col) => col.references("public.agentCodeExecutions.id").onDelete("set null"))
    .addColumn("toolName", sql`varchar(255) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("arguments", sql`text COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("result", sql`text COLLATE ${naturalCs}`)
    .addColumn("errorMessage", sql`text COLLATE ${naturalCs}`)
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("completedAt", "timestamptz")
    .execute();

  await db.schema
    .createIndex("agent_tool_calls_execution_id_idx")
    .on("public.agentToolCalls")
    .column("executionId")
    .execute();

  await db.schema
    .createIndex("agent_tool_calls_mcp_server_created_idx")
    .on("public.agentToolCalls")
    .columns(["mcpServerId", "createdAt"])
    .where(sql.ref("mcpServerId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("agent_tool_calls_skill_id_idx")
    .on("public.agentToolCalls")
    .column("skillId")
    .where(sql.ref("skillId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("agent_tool_calls_code_execution_id_idx")
    .on("public.agentToolCalls")
    .column("codeExecutionId")
    .where(sql.ref("codeExecutionId"), "is not", null)
    .execute();

  ////////////////////////////////

  await db.schema
    .alterTable("public.chatSessions")
    .addForeignKeyConstraint("chat_sessions_agent_id_fk", ["agentId"], "public.agents", ["id"], (cb) =>
      cb.onDelete("set null"),
    )
    .execute();
};

export const down = async (db: Kysely<Database>): Promise<void> => {
  await db.schema.dropTable("public.agentToolCalls").ifExists().execute();
  await db.schema.dropTable("public.agentCodeExecutions").ifExists().execute();
  await db.schema.dropTable("public.agentExecutions").ifExists().execute();
  await db.schema.dropTable("public.triageSpecialists").ifExists().execute();
  await db.schema.dropTable("public.agentSkills").ifExists().execute();
  await db.schema.dropTable("public.agentMcpServers").ifExists().execute();
  await db.schema.dropTable("public.agentAccess").ifExists().execute();
  await db.schema.dropTable("public.agents").ifExists().execute();
  await db.schema.dropTable("public.skillAccess").ifExists().execute();
  await db.schema.dropTable("public.skills").ifExists().execute();
  await db.schema.dropTable("public.mcpServerAccess").ifExists().execute();
  await db.schema.dropTable("public.mcpServers").ifExists().execute();
  await db.schema.dropTable("public.llmProviderAccess").ifExists().execute();
  await db.schema.dropTable("public.llmProviders").ifExists().execute();
  await db.schema.dropTable("public.chatSessionVfs").ifExists().execute();
  await db.schema.dropTable("public.chatMessages").ifExists().execute();
  await db.schema.dropTable("public.chatSessions").ifExists().execute();
  await db.schema.dropTable("public.settings").ifExists().execute();
  await db.schema.dropTable("public.sessions").ifExists().execute();
  await db.schema.dropTable("public.accounts").ifExists().execute();
  await db.schema.dropTable("public.rolePermissions").ifExists().execute();
  await db.schema.dropTable("public.groupRoles").ifExists().execute();
  await db.schema.dropTable("public.userRoles").ifExists().execute();
  await db.schema.dropTable("public.userGroups").ifExists().execute();
  await db.schema.dropTable("public.permissions").ifExists().execute();
  await db.schema.dropTable("public.roles").ifExists().execute();
  await db.schema.dropTable("public.groups").ifExists().execute();
  await db.schema.dropTable("public.users").ifExists().execute();
  await sql`DROP COLLATION IF EXISTS natural_cs`.execute(db);
};
