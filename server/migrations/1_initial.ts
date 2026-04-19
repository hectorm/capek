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

  // =============================================================================
  // Row Level Security (RLS) Setup
  // =============================================================================
  //
  // RLS provides database-level access control. Every query is automatically
  // filtered based on the current user's permissions and relationships.
  //
  // HOW IT WORKS:
  // -------------
  // 1. Application sets session variables via withUserTransaction():
  //    - app.user_id: Current user's UUID
  //    - app.user_groups: Array of group UUIDs the user belongs to
  //    - app.user_permissions: Array of permission strings (e.g., 'agent:read:own')
  //
  // 2. Helper functions read these variables:
  //    - auth.user_id(): Returns current user ID (NULL for system operations)
  //    - auth.user_groups(): Returns user's group memberships
  //    - auth.can_any(permissions): Returns true if user has ANY of the permissions
  //
  // 3. Each table has policies that define who can SELECT/INSERT/UPDATE/DELETE
  //
  // POLICY PATTERNS:
  // ----------------
  // *_system policies:
  //   Allow system operations (migrations, scheduled tasks) when auth.user_id() IS NULL.
  //   These bypass all user-level restrictions.
  //
  // Permission-based access:
  //   - ':all' permissions (e.g., 'agent:read:all') grant access to ALL rows
  //   - ':own' permissions (e.g., 'agent:read:own') require additional ownership checks
  //
  // Ownership via access tables:
  //   Resources like agents, llm_providers, and mcp_servers use *_access tables
  //   to track who has access. Two roles exist:
  //   - 'editor': Can update, delete, and grant access to others
  //   - 'user': Can read and execute (use) the resource
  //
  // Access can be granted to:
  //   - Individual users (user_id column)
  //   - Groups (group_id column) - all group members inherit access
  //
  // Implicit access:
  //   Some resources are visible through relationships:
  //   - Agent editors can see the LLM provider and MCP servers their agent uses
  //   - Triage editors can see specialist agents attached to their triage
  //   - Resource editors can see users/groups with whom they share access
  //
  // =============================================================================

  await db.schema.createSchema("auth").execute();

  // Function to get user ID from session variable
  await sql`
    CREATE FUNCTION auth.user_id()
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
    CREATE FUNCTION auth.user_groups()
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
    CREATE FUNCTION auth.user_permissions()
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
    CREATE FUNCTION auth.can(permissions TEXT[])
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT auth.user_id() IS NOT NULL AND COALESCE(permissions <@ auth.user_permissions(), FALSE);
    $$;
  `.execute(db);

  // Function to check if user has ANY permission from the list
  await sql`
    CREATE FUNCTION auth.can_any(permissions TEXT[])
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT auth.user_id() IS NOT NULL AND COALESCE(permissions && auth.user_permissions(), FALSE);
    $$;
  `.execute(db);

  // Function to check if user owns a resource with direct user_id ownership
  await sql`
    CREATE FUNCTION auth.is_owner(resource_type TEXT, resource_id UUID)
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT CASE resource_type
        WHEN 'chat_session' THEN EXISTS (
          SELECT 1 FROM public.chat_sessions
          WHERE id = resource_id AND user_id = auth.user_id()
        )
        WHEN 'execution' THEN EXISTS (
          SELECT 1 FROM public.agent_executions
          WHERE id = resource_id AND user_id = auth.user_id()
        )
        ELSE FALSE
      END;
    $$;
  `.execute(db);

  // Function to check if user has direct access to a shared resource via access tables
  await sql`
    CREATE FUNCTION auth.has_access(resource_type TEXT, resource_id UUID, required_roles TEXT[] DEFAULT ARRAY['editor', 'user'])
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
            AND (user_id = auth.user_id() OR group_id = ANY(auth.user_groups()))
        )
        WHEN 'llm_provider' THEN EXISTS (
          SELECT 1 FROM public.llm_provider_access
          WHERE llm_provider_id = resource_id
            AND role = ANY(required_roles)
            AND (user_id = auth.user_id() OR group_id = ANY(auth.user_groups()))
        )
        WHEN 'mcp_server' THEN EXISTS (
          SELECT 1 FROM public.mcp_server_access
          WHERE mcp_server_id = resource_id
            AND role = ANY(required_roles)
            AND (user_id = auth.user_id() OR group_id = ANY(auth.user_groups()))
        )
        WHEN 'skill' THEN EXISTS (
          SELECT 1 FROM public.skill_access
          WHERE skill_id = resource_id
            AND role = ANY(required_roles)
            AND (user_id = auth.user_id() OR group_id = ANY(auth.user_groups()))
        )
        ELSE FALSE
      END;
    $$;
  `.execute(db);

  // Function to check whether a specific agent already links to a specific resource.
  // This is used for context-scoped access checks that should not become reusable access across agents.
  await sql`
    CREATE FUNCTION auth.agent_has_linked_resource(agent_id UUID, resource_type TEXT, resource_id UUID)
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
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY users_select ON public.users
      FOR SELECT
      USING (
        auth.can_any(ARRAY['user:read:all', 'user:list:all'])
        OR (id = auth.user_id() AND auth.can_any(ARRAY['user:read:own']))
        -- Implicit: editors can see users with whom they share resource access
        OR EXISTS (
          SELECT 1 FROM public.agent_access aa1
          INNER JOIN public.agent_access aa2 ON aa1.agent_id = aa2.agent_id
          WHERE aa2.user_id = users.id
          AND aa1.role = 'editor'
          AND (aa1.user_id = auth.user_id() OR aa1.group_id = ANY(auth.user_groups()))
        )
        OR EXISTS (
          SELECT 1 FROM public.llm_provider_access lpa1
          INNER JOIN public.llm_provider_access lpa2 ON lpa1.llm_provider_id = lpa2.llm_provider_id
          WHERE lpa2.user_id = users.id
          AND lpa1.role = 'editor'
          AND (lpa1.user_id = auth.user_id() OR lpa1.group_id = ANY(auth.user_groups()))
        )
        OR EXISTS (
          SELECT 1 FROM public.mcp_server_access msa1
          INNER JOIN public.mcp_server_access msa2 ON msa1.mcp_server_id = msa2.mcp_server_id
          WHERE msa2.user_id = users.id
          AND msa1.role = 'editor'
          AND (msa1.user_id = auth.user_id() OR msa1.group_id = ANY(auth.user_groups()))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY users_insert ON public.users
      FOR INSERT
      WITH CHECK (auth.can_any(ARRAY['user:create']));
  `.execute(db);

  await sql`
    CREATE POLICY users_update ON public.users
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['user:update:all'])
        OR (id = auth.user_id() AND auth.can_any(ARRAY['user:update:own']))
      )
      WITH CHECK (
        auth.can_any(ARRAY['user:update:all'])
        OR (id = auth.user_id() AND auth.can_any(ARRAY['user:update:own']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY users_delete ON public.users
      FOR DELETE
      USING (auth.can_any(ARRAY['user:delete:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Groups
  // =============================================================================

  await sql`ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.groups FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY groups_system ON public.groups
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY groups_select ON public.groups
      FOR SELECT
      USING (
        auth.can_any(ARRAY['group:read:all', 'group:list:all'])
        OR (
          auth.can_any(ARRAY['group:read:own', 'group:list:own'])
          AND EXISTS (
            SELECT 1 FROM public.user_groups
            WHERE user_groups.group_id = groups.id
            AND user_groups.user_id = auth.user_id()
          )
        )
        -- Implicit: editors can see groups with whom they share resource access
        OR EXISTS (
          SELECT 1 FROM public.agent_access aa1
          INNER JOIN public.agent_access aa2 ON aa1.agent_id = aa2.agent_id
          WHERE aa2.group_id = groups.id
          AND aa1.role = 'editor'
          AND (aa1.user_id = auth.user_id() OR aa1.group_id = ANY(auth.user_groups()))
        )
        OR EXISTS (
          SELECT 1 FROM public.llm_provider_access lpa1
          INNER JOIN public.llm_provider_access lpa2 ON lpa1.llm_provider_id = lpa2.llm_provider_id
          WHERE lpa2.group_id = groups.id
          AND lpa1.role = 'editor'
          AND (lpa1.user_id = auth.user_id() OR lpa1.group_id = ANY(auth.user_groups()))
        )
        OR EXISTS (
          SELECT 1 FROM public.mcp_server_access msa1
          INNER JOIN public.mcp_server_access msa2 ON msa1.mcp_server_id = msa2.mcp_server_id
          WHERE msa2.group_id = groups.id
          AND msa1.role = 'editor'
          AND (msa1.user_id = auth.user_id() OR msa1.group_id = ANY(auth.user_groups()))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY groups_insert ON public.groups
      FOR INSERT
      WITH CHECK (auth.can_any(ARRAY['group:create']));
  `.execute(db);

  await sql`
    CREATE POLICY groups_update ON public.groups
      FOR UPDATE
      USING (auth.can_any(ARRAY['group:update:all']))
      WITH CHECK (auth.can_any(ARRAY['group:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY groups_delete ON public.groups
      FOR DELETE
      USING (auth.can_any(ARRAY['group:delete:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Roles
  // =============================================================================

  await sql`ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.roles FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY roles_system ON public.roles
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
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
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
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
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY user_groups_select ON public.user_groups
      FOR SELECT
      USING (
        auth.can_any(ARRAY['user:read:all', 'user:list:all', 'group:read:all', 'group:list:all'])
        OR user_id = auth.user_id()
      );
  `.execute(db);

  await sql`
    CREATE POLICY user_groups_insert ON public.user_groups
      FOR INSERT
      WITH CHECK (auth.can_any(ARRAY['user:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY user_groups_delete ON public.user_groups
      FOR DELETE
      USING (auth.can_any(ARRAY['user:update:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: User Roles
  // =============================================================================

  await sql`ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY user_roles_system ON public.user_roles
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY user_roles_select ON public.user_roles
      FOR SELECT
      USING (
        auth.can_any(ARRAY['user:read:all', 'user:list:all'])
        OR user_id = auth.user_id()
      );
  `.execute(db);

  await sql`
    CREATE POLICY user_roles_insert ON public.user_roles
      FOR INSERT
      WITH CHECK (auth.can_any(ARRAY['user:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY user_roles_delete ON public.user_roles
      FOR DELETE
      USING (auth.can_any(ARRAY['user:update:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Group Roles
  // =============================================================================

  await sql`ALTER TABLE public.group_roles ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.group_roles FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY group_roles_system ON public.group_roles
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY group_roles_select ON public.group_roles
      FOR SELECT
      USING (
        auth.can_any(ARRAY['group:read:all', 'group:list:all'])
        OR (
          auth.can_any(ARRAY['group:read:own', 'group:list:own'])
          AND EXISTS (
            SELECT 1 FROM public.user_groups
            WHERE user_groups.group_id = group_roles.group_id
            AND user_groups.user_id = auth.user_id()
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY group_roles_insert ON public.group_roles
      FOR INSERT
      WITH CHECK (auth.can_any(ARRAY['group:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY group_roles_delete ON public.group_roles
      FOR DELETE
      USING (auth.can_any(ARRAY['group:update:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Role Permissions
  // =============================================================================

  await sql`ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY role_permissions_system ON public.role_permissions
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
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
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  // =============================================================================
  // RLS Policies: Sessions
  // =============================================================================

  await sql`ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.sessions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY sessions_system ON public.sessions
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  // =============================================================================
  // RLS Policies: Settings
  // =============================================================================

  await sql`ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.settings FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY settings_system ON public.settings
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY settings_select ON public.settings
      FOR SELECT
      -- Note: public vs private filtering is handled at application level
      USING (auth.can_any(ARRAY['settings:read:all', 'settings:list:all', 'settings:read:public', 'settings:list:public']));
  `.execute(db);

  await sql`
    CREATE POLICY settings_insert ON public.settings
      FOR INSERT
      WITH CHECK (auth.can_any(ARRAY['settings:create']));
  `.execute(db);

  await sql`
    CREATE POLICY settings_update ON public.settings
      FOR UPDATE
      USING (auth.can_any(ARRAY['settings:update:all']))
      WITH CHECK (auth.can_any(ARRAY['settings:update:all']));
  `.execute(db);

  await sql`
    CREATE POLICY settings_delete ON public.settings
      FOR DELETE
      USING (auth.can_any(ARRAY['settings:delete:all']));
  `.execute(db);

  // =============================================================================
  // RLS Policies: Chat Sessions
  // =============================================================================

  await sql`ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.chat_sessions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY chat_sessions_system ON public.chat_sessions
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY chat_sessions_select ON public.chat_sessions
      FOR SELECT
      USING (
        auth.can_any(ARRAY['chat:read:all', 'chat:list:all'])
        OR (user_id = auth.user_id() AND auth.can_any(ARRAY['chat:read:own', 'chat:list:own']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_sessions_insert ON public.chat_sessions
      FOR INSERT
      WITH CHECK (
        user_id = auth.user_id()
        AND auth.can_any(ARRAY['chat:create'])
        -- Requires use permission on the agent being attached
        AND (
          agent_id IS NULL
          OR auth.can_any(ARRAY['agent:use:all'])
          OR (
            auth.can_any(ARRAY['agent:use:own'])
            AND auth.has_access('agent', agent_id)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_sessions_update ON public.chat_sessions
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['chat:update:all'])
        OR (user_id = auth.user_id() AND auth.can_any(ARRAY['chat:update:own']))
      )
      WITH CHECK (
        (
          auth.can_any(ARRAY['chat:update:all'])
          OR (user_id = auth.user_id() AND auth.can_any(ARRAY['chat:update:own']))
        )
        -- Requires use permission on the agent being attached
        AND (
          agent_id IS NULL
          OR auth.can_any(ARRAY['agent:use:all'])
          OR (
            auth.can_any(ARRAY['agent:use:own'])
            AND auth.has_access('agent', agent_id)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_sessions_delete ON public.chat_sessions
      FOR DELETE
      USING (
        auth.can_any(ARRAY['chat:delete:all'])
        OR (user_id = auth.user_id() AND auth.can_any(ARRAY['chat:delete:own']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Chat Messages
  // =============================================================================

  await sql`ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.chat_messages FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY chat_messages_system ON public.chat_messages
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY chat_messages_select ON public.chat_messages
      FOR SELECT
      USING (
        auth.can_any(ARRAY['chat:read:all', 'chat:list:all'])
        OR (auth.can_any(ARRAY['chat:read:own', 'chat:list:own']) AND auth.is_owner('chat_session', session_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_messages_insert ON public.chat_messages
      FOR INSERT
      WITH CHECK (
        auth.can_any(ARRAY['chat:create']) AND auth.is_owner('chat_session', session_id)
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_messages_update ON public.chat_messages
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['chat:update:all'])
        -- Users can only update their own 'user' role messages (not AI responses)
        OR (auth.can_any(ARRAY['chat:update:own']) AND role = 'user' AND auth.is_owner('chat_session', session_id))
      )
      WITH CHECK (
        auth.can_any(ARRAY['chat:update:all'])
        OR (auth.can_any(ARRAY['chat:update:own']) AND role = 'user' AND auth.is_owner('chat_session', session_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY chat_messages_delete ON public.chat_messages
      FOR DELETE
      USING (
        auth.can_any(ARRAY['chat:delete:all'])
        OR (auth.can_any(ARRAY['chat:delete:own']) AND auth.is_owner('chat_session', session_id))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Chat Session VFS
  // =============================================================================

  await sql`ALTER TABLE public.chat_session_vfs ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.chat_session_vfs FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_system ON public.chat_session_vfs
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_select ON public.chat_session_vfs
      FOR SELECT
      USING (auth.is_owner('chat_session', session_id));
  `.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_insert ON public.chat_session_vfs
      FOR INSERT
      WITH CHECK (auth.is_owner('chat_session', session_id));
  `.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_update ON public.chat_session_vfs
      FOR UPDATE
      USING (auth.is_owner('chat_session', session_id))
      WITH CHECK (auth.is_owner('chat_session', session_id));
  `.execute(db);

  await sql`
    CREATE POLICY chat_session_vfs_delete ON public.chat_session_vfs
      FOR DELETE
      USING (auth.is_owner('chat_session', session_id));
  `.execute(db);

  // =============================================================================
  // RLS Policies: LLM Providers
  // =============================================================================

  await sql`ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.llm_providers FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY llm_providers_system ON public.llm_providers
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY llm_providers_select ON public.llm_providers
      FOR SELECT
      USING (
        auth.can_any(ARRAY['llm_provider:read:all', 'llm_provider:list:all', 'llm_provider:update:all', 'llm_provider:delete:all', 'llm_provider:use:all'])
        OR (
          auth.can_any(ARRAY['llm_provider:read:own', 'llm_provider:list:own', 'llm_provider:update:own', 'llm_provider:delete:own', 'llm_provider:use:own'])
          AND auth.has_access('llm_provider', id)
        )
        -- Implicit: agent users can see the LLM provider their agent uses
        OR EXISTS (
          SELECT 1 FROM public.agents
          WHERE agents.llm_provider_id = llm_providers.id
          AND auth.has_access('agent', agents.id)
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY llm_providers_insert ON public.llm_providers
      FOR INSERT
      WITH CHECK (auth.can_any(ARRAY['llm_provider:create']));
  `.execute(db);

  await sql`
    CREATE POLICY llm_providers_update ON public.llm_providers
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['llm_provider:update:all'])
        OR (auth.can_any(ARRAY['llm_provider:update:own']) AND auth.has_access('llm_provider', id, ARRAY['editor']))
      )
      WITH CHECK (
        auth.can_any(ARRAY['llm_provider:update:all'])
        OR (auth.can_any(ARRAY['llm_provider:update:own']) AND auth.has_access('llm_provider', id, ARRAY['editor']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY llm_providers_delete ON public.llm_providers
      FOR DELETE
      USING (
        auth.can_any(ARRAY['llm_provider:delete:all'])
        OR (auth.can_any(ARRAY['llm_provider:delete:own']) AND auth.has_access('llm_provider', id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: LLM Provider Access
  // =============================================================================

  await sql`ALTER TABLE public.llm_provider_access ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.llm_provider_access FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY llm_provider_access_system ON public.llm_provider_access
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  // Note: Doesn't filter by resource access to avoid RLS recursion (has_access queries this table).
  // Users with :own permissions can see access metadata for all resources, but not resource content.
  await sql`
    CREATE POLICY llm_provider_access_select ON public.llm_provider_access
      FOR SELECT
      USING (
        auth.can_any(ARRAY['llm_provider:read:all', 'llm_provider:update:all', 'llm_provider:read:own', 'llm_provider:update:own'])
      );
  `.execute(db);

  await sql`
    CREATE POLICY llm_provider_access_insert ON public.llm_provider_access
      FOR INSERT
      WITH CHECK (
        auth.can_any(ARRAY['llm_provider:update:all'])
        OR (auth.can_any(ARRAY['llm_provider:update:own']) AND auth.has_access('llm_provider', llm_provider_id, ARRAY['editor']))
        -- Implicit creator self-grant: creator can grant access to themselves only when no other users or groups have access
        OR (
          auth.can_any(ARRAY['llm_provider:create'])
          AND user_id = auth.user_id()
          AND NOT EXISTS (
            SELECT 1 FROM public.llm_provider_access lpa
            WHERE lpa.llm_provider_id = llm_provider_access.llm_provider_id
            AND (lpa.user_id IS DISTINCT FROM auth.user_id() OR lpa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY llm_provider_access_delete ON public.llm_provider_access
      FOR DELETE
      USING (
        auth.can_any(ARRAY['llm_provider:update:all'])
        OR (auth.can_any(ARRAY['llm_provider:update:own']) AND auth.has_access('llm_provider', llm_provider_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: MCP Servers
  // =============================================================================

  await sql`ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.mcp_servers FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY mcp_servers_system ON public.mcp_servers
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY mcp_servers_select ON public.mcp_servers
      FOR SELECT
      USING (
        auth.can_any(ARRAY['mcp_server:read:all', 'mcp_server:list:all', 'mcp_server:update:all', 'mcp_server:delete:all', 'mcp_server:use:all'])
        OR (
          auth.can_any(ARRAY['mcp_server:read:own', 'mcp_server:list:own', 'mcp_server:update:own', 'mcp_server:delete:own', 'mcp_server:use:own'])
          AND auth.has_access('mcp_server', id)
        )
        -- Implicit: agent users can see MCP servers attached to their agents
        OR EXISTS (
          SELECT 1 FROM public.agent_mcp_servers
          WHERE agent_mcp_servers.mcp_server_id = mcp_servers.id
          AND auth.has_access('agent', agent_mcp_servers.agent_id)
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY mcp_servers_insert ON public.mcp_servers
      FOR INSERT
      WITH CHECK (auth.can_any(ARRAY['mcp_server:create']));
  `.execute(db);

  await sql`
    CREATE POLICY mcp_servers_update ON public.mcp_servers
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['mcp_server:update:all'])
        OR (auth.can_any(ARRAY['mcp_server:update:own']) AND auth.has_access('mcp_server', id, ARRAY['editor']))
      )
      WITH CHECK (
        auth.can_any(ARRAY['mcp_server:update:all'])
        OR (auth.can_any(ARRAY['mcp_server:update:own']) AND auth.has_access('mcp_server', id, ARRAY['editor']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY mcp_servers_delete ON public.mcp_servers
      FOR DELETE
      USING (
        auth.can_any(ARRAY['mcp_server:delete:all'])
        OR (auth.can_any(ARRAY['mcp_server:delete:own']) AND auth.has_access('mcp_server', id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: MCP Server Access
  // =============================================================================

  await sql`ALTER TABLE public.mcp_server_access ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.mcp_server_access FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY mcp_server_access_system ON public.mcp_server_access
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  // Note: See llm_provider_access_select comment
  await sql`
    CREATE POLICY mcp_server_access_select ON public.mcp_server_access
      FOR SELECT
      USING (
        auth.can_any(ARRAY['mcp_server:read:all', 'mcp_server:update:all', 'mcp_server:read:own', 'mcp_server:update:own'])
      );
  `.execute(db);

  await sql`
    CREATE POLICY mcp_server_access_insert ON public.mcp_server_access
      FOR INSERT
      WITH CHECK (
        auth.can_any(ARRAY['mcp_server:update:all'])
        OR (auth.can_any(ARRAY['mcp_server:update:own']) AND auth.has_access('mcp_server', mcp_server_id, ARRAY['editor']))
        -- Implicit creator self-grant: creator can grant access to themselves only when no other users or groups have access
        OR (
          auth.can_any(ARRAY['mcp_server:create'])
          AND user_id = auth.user_id()
          AND NOT EXISTS (
            SELECT 1 FROM public.mcp_server_access msa
            WHERE msa.mcp_server_id = mcp_server_access.mcp_server_id
            AND (msa.user_id IS DISTINCT FROM auth.user_id() OR msa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY mcp_server_access_delete ON public.mcp_server_access
      FOR DELETE
      USING (
        auth.can_any(ARRAY['mcp_server:update:all'])
        OR (auth.can_any(ARRAY['mcp_server:update:own']) AND auth.has_access('mcp_server', mcp_server_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Skills
  // =============================================================================

  await sql`ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.skills FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY skills_system ON public.skills
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY skills_select ON public.skills
      FOR SELECT
      USING (
        auth.can_any(ARRAY['skill:read:all', 'skill:list:all', 'skill:update:all', 'skill:delete:all', 'skill:use:all'])
        OR (
          auth.can_any(ARRAY['skill:read:own', 'skill:list:own', 'skill:update:own', 'skill:delete:own', 'skill:use:own'])
          AND auth.has_access('skill', id)
        )
        -- Implicit: agent users can see skills attached to their agents
        OR EXISTS (
          SELECT 1 FROM public.agent_skills
          WHERE agent_skills.skill_id = skills.id
          AND auth.has_access('agent', agent_skills.agent_id)
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY skills_insert ON public.skills
      FOR INSERT
      WITH CHECK (auth.can_any(ARRAY['skill:create']));
  `.execute(db);

  await sql`
    CREATE POLICY skills_update ON public.skills
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['skill:update:all'])
        OR (auth.can_any(ARRAY['skill:update:own']) AND auth.has_access('skill', id, ARRAY['editor']))
      )
      WITH CHECK (
        auth.can_any(ARRAY['skill:update:all'])
        OR (auth.can_any(ARRAY['skill:update:own']) AND auth.has_access('skill', id, ARRAY['editor']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY skills_delete ON public.skills
      FOR DELETE
      USING (
        auth.can_any(ARRAY['skill:delete:all'])
        OR (auth.can_any(ARRAY['skill:delete:own']) AND auth.has_access('skill', id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Skill Access
  // =============================================================================

  await sql`ALTER TABLE public.skill_access ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.skill_access FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY skill_access_system ON public.skill_access
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  // Note: See llm_provider_access_select comment
  await sql`
    CREATE POLICY skill_access_select ON public.skill_access
      FOR SELECT
      USING (
        auth.can_any(ARRAY['skill:read:all', 'skill:update:all', 'skill:read:own', 'skill:update:own'])
      );
  `.execute(db);

  await sql`
    CREATE POLICY skill_access_insert ON public.skill_access
      FOR INSERT
      WITH CHECK (
        auth.can_any(ARRAY['skill:update:all'])
        OR (auth.can_any(ARRAY['skill:update:own']) AND auth.has_access('skill', skill_id, ARRAY['editor']))
        -- Implicit creator self-grant: creator can grant access to themselves only when no other users or groups have access
        OR (
          auth.can_any(ARRAY['skill:create'])
          AND user_id = auth.user_id()
          AND NOT EXISTS (
            SELECT 1 FROM public.skill_access sa
            WHERE sa.skill_id = skill_access.skill_id
            AND (sa.user_id IS DISTINCT FROM auth.user_id() OR sa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY skill_access_delete ON public.skill_access
      FOR DELETE
      USING (
        auth.can_any(ARRAY['skill:update:all'])
        OR (auth.can_any(ARRAY['skill:update:own']) AND auth.has_access('skill', skill_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agents
  // =============================================================================

  await sql`ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agents FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agents_system ON public.agents
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agents_select ON public.agents
      FOR SELECT
      USING (
        auth.can_any(ARRAY['agent:read:all', 'agent:list:all', 'agent:update:all', 'agent:delete:all', 'agent:use:all'])
        OR (
          auth.can_any(ARRAY['agent:read:own', 'agent:list:own', 'agent:update:own', 'agent:delete:own', 'agent:use:own'])
          AND auth.has_access('agent', id)
        )
        -- Implicit: triage editors can see specialist agents attached to their triage
        OR EXISTS (
          SELECT 1 FROM public.triage_specialists
          WHERE triage_specialists.specialist_agent_id = agents.id
          AND auth.has_access('agent', triage_specialists.triage_agent_id, ARRAY['editor'])
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agents_insert ON public.agents
      FOR INSERT
      WITH CHECK (
        auth.can_any(ARRAY['agent:create'])
        -- Requires use permission on the LLM provider being assigned
        AND (
          llm_provider_id IS NULL
          OR auth.can_any(ARRAY['llm_provider:use:all'])
          OR (
            auth.can_any(ARRAY['llm_provider:use:own'])
            AND auth.has_access('llm_provider', llm_provider_id)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agents_update ON public.agents
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['agent:update:all'])
        OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', id, ARRAY['editor']))
      )
      WITH CHECK (
        -- Requires update permission on the agent
        (
          auth.can_any(ARRAY['agent:update:all'])
          OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', id, ARRAY['editor']))
        )
        -- Requires use permission on the LLM provider being assigned
        AND (
          llm_provider_id IS NULL
          OR auth.can_any(ARRAY['llm_provider:use:all'])
          OR (
            auth.can_any(ARRAY['llm_provider:use:own'])
            AND (
              auth.has_access('llm_provider', llm_provider_id)
              OR auth.agent_has_linked_resource(id, 'llm_provider', llm_provider_id)
            )
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agents_delete ON public.agents
      FOR DELETE
      USING (
        auth.can_any(ARRAY['agent:delete:all'])
        OR (auth.can_any(ARRAY['agent:delete:own']) AND auth.has_access('agent', id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Access
  // =============================================================================

  await sql`ALTER TABLE public.agent_access ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_access FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_access_system ON public.agent_access
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  // Note: See llm_provider_access_select comment
  await sql`
    CREATE POLICY agent_access_select ON public.agent_access
      FOR SELECT
      USING (
        auth.can_any(ARRAY['agent:read:all', 'agent:update:all', 'agent:read:own', 'agent:update:own'])
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_access_insert ON public.agent_access
      FOR INSERT
      WITH CHECK (
        auth.can_any(ARRAY['agent:update:all'])
        OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', agent_id, ARRAY['editor']))
        -- Implicit creator self-grant: creator can grant access to themselves only when no other users or groups have access
        OR (
          auth.can_any(ARRAY['agent:create'])
          AND user_id = auth.user_id()
          AND NOT EXISTS (
            SELECT 1 FROM public.agent_access aa
            WHERE aa.agent_id = agent_access.agent_id
            AND (aa.user_id IS DISTINCT FROM auth.user_id() OR aa.group_id IS NOT NULL)
          )
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_access_delete ON public.agent_access
      FOR DELETE
      USING (
        auth.can_any(ARRAY['agent:update:all'])
        OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', agent_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent MCP Servers
  // =============================================================================

  await sql`ALTER TABLE public.agent_mcp_servers ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_mcp_servers FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_mcp_servers_system ON public.agent_mcp_servers
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_mcp_servers_select ON public.agent_mcp_servers
      FOR SELECT
      USING (
        auth.can_any(ARRAY['agent:read:all', 'agent:update:all', 'agent:use:all'])
        OR (
          auth.can_any(ARRAY['agent:read:own', 'agent:update:own', 'agent:use:own'])
          AND auth.has_access('agent', agent_id)
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_mcp_servers_insert ON public.agent_mcp_servers
      FOR INSERT
      WITH CHECK (
        -- Requires update permission on the agent
        (
          auth.can_any(ARRAY['agent:update:all'])
          OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', agent_id, ARRAY['editor']))
        )
        -- Requires use permission on the MCP server being assigned
        AND (
          auth.can_any(ARRAY['mcp_server:use:all'])
          OR (auth.can_any(ARRAY['mcp_server:use:own']) AND auth.has_access('mcp_server', mcp_server_id))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_mcp_servers_delete ON public.agent_mcp_servers
      FOR DELETE
      USING (
        auth.can_any(ARRAY['agent:update:all'])
        OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', agent_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Skills
  // =============================================================================

  await sql`ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_skills FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_skills_system ON public.agent_skills
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_skills_select ON public.agent_skills
      FOR SELECT
      USING (
        auth.can_any(ARRAY['agent:read:all', 'agent:update:all', 'agent:use:all'])
        OR (
          auth.can_any(ARRAY['agent:read:own', 'agent:update:own', 'agent:use:own'])
          AND auth.has_access('agent', agent_id)
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_skills_insert ON public.agent_skills
      FOR INSERT
      WITH CHECK (
        -- Requires update permission on the agent
        (
          auth.can_any(ARRAY['agent:update:all'])
          OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', agent_id, ARRAY['editor']))
        )
        -- Requires use permission on the skill being assigned
        AND (
          auth.can_any(ARRAY['skill:use:all'])
          OR (auth.can_any(ARRAY['skill:use:own']) AND auth.has_access('skill', skill_id))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_skills_delete ON public.agent_skills
      FOR DELETE
      USING (
        auth.can_any(ARRAY['agent:update:all'])
        OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', agent_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Triage Specialists
  // =============================================================================

  await sql`ALTER TABLE public.triage_specialists ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.triage_specialists FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY triage_specialists_system ON public.triage_specialists
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY triage_specialists_select ON public.triage_specialists
      FOR SELECT
      USING (
        auth.can_any(ARRAY['agent:read:all', 'agent:update:all', 'agent:use:all'])
        OR (
          auth.can_any(ARRAY['agent:read:own', 'agent:update:own', 'agent:use:own'])
          AND auth.has_access('agent', triage_agent_id)
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY triage_specialists_insert ON public.triage_specialists
      FOR INSERT
      WITH CHECK (
        -- Requires update permission on the triage agent
        (
          auth.can_any(ARRAY['agent:update:all'])
          OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', triage_agent_id, ARRAY['editor']))
        )
        -- Requires use permission on the specialist agent being assigned
        AND (
          auth.can_any(ARRAY['agent:use:all'])
          OR (auth.can_any(ARRAY['agent:use:own']) AND auth.has_access('agent', specialist_agent_id))
        )
      );
  `.execute(db);

  await sql`
    CREATE POLICY triage_specialists_delete ON public.triage_specialists
      FOR DELETE
      USING (
        auth.can_any(ARRAY['agent:update:all'])
        OR (auth.can_any(ARRAY['agent:update:own']) AND auth.has_access('agent', triage_agent_id, ARRAY['editor']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Executions
  // =============================================================================

  await sql`ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_executions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_executions_system ON public.agent_executions
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_executions_select ON public.agent_executions
      FOR SELECT
      USING (
        auth.can_any(ARRAY['execution:read:all', 'execution:list:all'])
        OR (user_id = auth.user_id() AND auth.can_any(ARRAY['execution:read:own', 'execution:list:own']))
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_executions_insert ON public.agent_executions
      FOR INSERT
      WITH CHECK (
        user_id = auth.user_id()
        AND auth.can_any(ARRAY['chat:create'])
        -- Requires use permission on the agent being executed
        AND (
          auth.can_any(ARRAY['agent:use:all'])
          OR (
            auth.can_any(ARRAY['agent:use:own'])
            AND auth.has_access('agent', agent_id)
          )
        )
        -- Requires ownership of the chat session
        AND (session_id IS NULL OR auth.is_owner('chat_session', session_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_executions_update ON public.agent_executions
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['execution:cancel:all'])
        OR (user_id = auth.user_id() AND auth.can_any(ARRAY['execution:cancel:own']))
      )
      WITH CHECK (
        auth.can_any(ARRAY['execution:cancel:all'])
        OR (user_id = auth.user_id() AND auth.can_any(ARRAY['execution:cancel:own']))
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Code Executions
  // =============================================================================

  await sql`ALTER TABLE public.agent_code_executions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_code_executions FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_code_executions_system ON public.agent_code_executions
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_code_executions_select ON public.agent_code_executions
      FOR SELECT
      USING (
        auth.can_any(ARRAY['execution:list:all', 'execution:read:all'])
        OR (auth.can_any(ARRAY['execution:list:own', 'execution:read:own']) AND auth.is_owner('execution', execution_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_code_executions_insert ON public.agent_code_executions
      FOR INSERT
      WITH CHECK (
        auth.can_any(ARRAY['chat:create']) AND auth.is_owner('execution', execution_id)
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_code_executions_update ON public.agent_code_executions
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['chat:update:own']) AND auth.is_owner('execution', execution_id)
      )
      WITH CHECK (
        auth.can_any(ARRAY['chat:update:own']) AND auth.is_owner('execution', execution_id)
      );
  `.execute(db);

  // =============================================================================
  // RLS Policies: Agent Tool Calls
  // =============================================================================

  await sql`ALTER TABLE public.agent_tool_calls ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_tool_calls FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY agent_tool_calls_system ON public.agent_tool_calls
      USING (auth.user_id() IS NULL)
      WITH CHECK (auth.user_id() IS NULL);
  `.execute(db);

  await sql`
    CREATE POLICY agent_tool_calls_select ON public.agent_tool_calls
      FOR SELECT
      USING (
        auth.can_any(ARRAY['execution:list:all', 'execution:read:all'])
        OR (auth.can_any(ARRAY['execution:list:own', 'execution:read:own']) AND auth.is_owner('execution', execution_id))
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_tool_calls_insert ON public.agent_tool_calls
      FOR INSERT
      WITH CHECK (
        auth.can_any(ARRAY['chat:create']) AND auth.is_owner('execution', execution_id)
      );
  `.execute(db);

  await sql`
    CREATE POLICY agent_tool_calls_update ON public.agent_tool_calls
      FOR UPDATE
      USING (
        auth.can_any(ARRAY['chat:update:own']) AND auth.is_owner('execution', execution_id)
      )
      WITH CHECK (
        auth.can_any(ARRAY['chat:update:own']) AND auth.is_owner('execution', execution_id)
      );
  `.execute(db);
};

export const down = async (db: Kysely<Database>): Promise<void> => {
  await sql`DROP POLICY IF EXISTS users_system ON public.users`.execute(db);
  await sql`DROP POLICY IF EXISTS users_select ON public.users`.execute(db);
  await sql`DROP POLICY IF EXISTS users_insert ON public.users`.execute(db);
  await sql`DROP POLICY IF EXISTS users_update ON public.users`.execute(db);
  await sql`DROP POLICY IF EXISTS users_delete ON public.users`.execute(db);

  await sql`DROP POLICY IF EXISTS groups_system ON public.groups`.execute(db);
  await sql`DROP POLICY IF EXISTS groups_select ON public.groups`.execute(db);
  await sql`DROP POLICY IF EXISTS groups_insert ON public.groups`.execute(db);
  await sql`DROP POLICY IF EXISTS groups_update ON public.groups`.execute(db);
  await sql`DROP POLICY IF EXISTS groups_delete ON public.groups`.execute(db);

  await sql`DROP POLICY IF EXISTS roles_system ON public.roles`.execute(db);
  await sql`DROP POLICY IF EXISTS roles_select ON public.roles`.execute(db);
  await sql`DROP POLICY IF EXISTS roles_insert ON public.roles`.execute(db);
  await sql`DROP POLICY IF EXISTS roles_update ON public.roles`.execute(db);
  await sql`DROP POLICY IF EXISTS roles_delete ON public.roles`.execute(db);

  await sql`DROP POLICY IF EXISTS permissions_system ON public.permissions`.execute(db);
  await sql`DROP POLICY IF EXISTS permissions_select ON public.permissions`.execute(db);

  await sql`DROP POLICY IF EXISTS user_groups_system ON public.user_groups`.execute(db);
  await sql`DROP POLICY IF EXISTS user_groups_select ON public.user_groups`.execute(db);
  await sql`DROP POLICY IF EXISTS user_groups_insert ON public.user_groups`.execute(db);
  await sql`DROP POLICY IF EXISTS user_groups_delete ON public.user_groups`.execute(db);

  await sql`DROP POLICY IF EXISTS user_roles_system ON public.user_roles`.execute(db);
  await sql`DROP POLICY IF EXISTS user_roles_select ON public.user_roles`.execute(db);
  await sql`DROP POLICY IF EXISTS user_roles_insert ON public.user_roles`.execute(db);
  await sql`DROP POLICY IF EXISTS user_roles_delete ON public.user_roles`.execute(db);

  await sql`DROP POLICY IF EXISTS group_roles_system ON public.group_roles`.execute(db);
  await sql`DROP POLICY IF EXISTS group_roles_select ON public.group_roles`.execute(db);
  await sql`DROP POLICY IF EXISTS group_roles_insert ON public.group_roles`.execute(db);
  await sql`DROP POLICY IF EXISTS group_roles_delete ON public.group_roles`.execute(db);

  await sql`DROP POLICY IF EXISTS role_permissions_system ON public.role_permissions`.execute(db);
  await sql`DROP POLICY IF EXISTS role_permissions_select ON public.role_permissions`.execute(db);
  await sql`DROP POLICY IF EXISTS role_permissions_insert ON public.role_permissions`.execute(db);
  await sql`DROP POLICY IF EXISTS role_permissions_delete ON public.role_permissions`.execute(db);

  await sql`DROP POLICY IF EXISTS accounts_system ON public.accounts`.execute(db);
  await sql`DROP POLICY IF EXISTS accounts_select ON public.accounts`.execute(db);
  await sql`DROP POLICY IF EXISTS accounts_insert ON public.accounts`.execute(db);
  await sql`DROP POLICY IF EXISTS accounts_update ON public.accounts`.execute(db);
  await sql`DROP POLICY IF EXISTS accounts_delete ON public.accounts`.execute(db);

  await sql`DROP POLICY IF EXISTS sessions_system ON public.sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS sessions_select ON public.sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS sessions_insert ON public.sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS sessions_update ON public.sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS sessions_delete ON public.sessions`.execute(db);

  await sql`DROP POLICY IF EXISTS settings_system ON public.settings`.execute(db);
  await sql`DROP POLICY IF EXISTS settings_select ON public.settings`.execute(db);
  await sql`DROP POLICY IF EXISTS settings_insert ON public.settings`.execute(db);
  await sql`DROP POLICY IF EXISTS settings_update ON public.settings`.execute(db);
  await sql`DROP POLICY IF EXISTS settings_delete ON public.settings`.execute(db);

  await sql`DROP POLICY IF EXISTS chat_sessions_system ON public.chat_sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_sessions_select ON public.chat_sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_sessions_select_own ON public.chat_sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_sessions_insert ON public.chat_sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_sessions_insert_own ON public.chat_sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_sessions_update ON public.chat_sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_sessions_update_own ON public.chat_sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_sessions_delete ON public.chat_sessions`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_sessions_delete_own ON public.chat_sessions`.execute(db);

  await sql`DROP POLICY IF EXISTS chat_messages_system ON public.chat_messages`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_messages_select_own ON public.chat_messages`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_messages_insert_own ON public.chat_messages`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_messages_update ON public.chat_messages`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_messages_update_own ON public.chat_messages`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_messages_delete ON public.chat_messages`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_messages_delete_own ON public.chat_messages`.execute(db);

  await sql`DROP POLICY IF EXISTS chat_session_vfs_system ON public.chat_session_vfs`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_session_vfs_select ON public.chat_session_vfs`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_session_vfs_insert ON public.chat_session_vfs`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_session_vfs_update ON public.chat_session_vfs`.execute(db);
  await sql`DROP POLICY IF EXISTS chat_session_vfs_delete ON public.chat_session_vfs`.execute(db);

  await sql`DROP POLICY IF EXISTS llm_providers_system ON public.llm_providers`.execute(db);
  await sql`DROP POLICY IF EXISTS llm_providers_select ON public.llm_providers`.execute(db);
  await sql`DROP POLICY IF EXISTS llm_providers_insert ON public.llm_providers`.execute(db);
  await sql`DROP POLICY IF EXISTS llm_providers_update ON public.llm_providers`.execute(db);
  await sql`DROP POLICY IF EXISTS llm_providers_delete ON public.llm_providers`.execute(db);

  await sql`DROP POLICY IF EXISTS llm_provider_access_system ON public.llm_provider_access`.execute(db);
  await sql`DROP POLICY IF EXISTS llm_provider_access_select ON public.llm_provider_access`.execute(db);
  await sql`DROP POLICY IF EXISTS llm_provider_access_insert ON public.llm_provider_access`.execute(db);
  await sql`DROP POLICY IF EXISTS llm_provider_access_delete ON public.llm_provider_access`.execute(db);

  await sql`DROP POLICY IF EXISTS mcp_servers_system ON public.mcp_servers`.execute(db);
  await sql`DROP POLICY IF EXISTS mcp_servers_select ON public.mcp_servers`.execute(db);
  await sql`DROP POLICY IF EXISTS mcp_servers_insert ON public.mcp_servers`.execute(db);
  await sql`DROP POLICY IF EXISTS mcp_servers_update ON public.mcp_servers`.execute(db);
  await sql`DROP POLICY IF EXISTS mcp_servers_delete ON public.mcp_servers`.execute(db);

  await sql`DROP POLICY IF EXISTS mcp_server_access_system ON public.mcp_server_access`.execute(db);
  await sql`DROP POLICY IF EXISTS mcp_server_access_select ON public.mcp_server_access`.execute(db);
  await sql`DROP POLICY IF EXISTS mcp_server_access_insert ON public.mcp_server_access`.execute(db);
  await sql`DROP POLICY IF EXISTS mcp_server_access_delete ON public.mcp_server_access`.execute(db);

  await sql`DROP POLICY IF EXISTS skills_system ON public.skills`.execute(db);
  await sql`DROP POLICY IF EXISTS skills_select ON public.skills`.execute(db);
  await sql`DROP POLICY IF EXISTS skills_insert ON public.skills`.execute(db);
  await sql`DROP POLICY IF EXISTS skills_update ON public.skills`.execute(db);
  await sql`DROP POLICY IF EXISTS skills_delete ON public.skills`.execute(db);

  await sql`DROP POLICY IF EXISTS skill_access_system ON public.skill_access`.execute(db);
  await sql`DROP POLICY IF EXISTS skill_access_select ON public.skill_access`.execute(db);
  await sql`DROP POLICY IF EXISTS skill_access_insert ON public.skill_access`.execute(db);
  await sql`DROP POLICY IF EXISTS skill_access_delete ON public.skill_access`.execute(db);

  await sql`DROP POLICY IF EXISTS agents_system ON public.agents`.execute(db);
  await sql`DROP POLICY IF EXISTS agents_select ON public.agents`.execute(db);
  await sql`DROP POLICY IF EXISTS agents_insert ON public.agents`.execute(db);
  await sql`DROP POLICY IF EXISTS agents_update ON public.agents`.execute(db);
  await sql`DROP POLICY IF EXISTS agents_delete ON public.agents`.execute(db);

  await sql`DROP POLICY IF EXISTS agent_access_system ON public.agent_access`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_access_select ON public.agent_access`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_access_insert ON public.agent_access`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_access_delete ON public.agent_access`.execute(db);

  await sql`DROP POLICY IF EXISTS agent_mcp_servers_system ON public.agent_mcp_servers`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_mcp_servers_select ON public.agent_mcp_servers`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_mcp_servers_insert ON public.agent_mcp_servers`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_mcp_servers_delete ON public.agent_mcp_servers`.execute(db);

  await sql`DROP POLICY IF EXISTS agent_skills_system ON public.agent_skills`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_skills_select ON public.agent_skills`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_skills_insert ON public.agent_skills`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_skills_delete ON public.agent_skills`.execute(db);

  await sql`DROP POLICY IF EXISTS triage_specialists_system ON public.triage_specialists`.execute(db);
  await sql`DROP POLICY IF EXISTS triage_specialists_select ON public.triage_specialists`.execute(db);
  await sql`DROP POLICY IF EXISTS triage_specialists_insert ON public.triage_specialists`.execute(db);
  await sql`DROP POLICY IF EXISTS triage_specialists_delete ON public.triage_specialists`.execute(db);

  await sql`DROP POLICY IF EXISTS agent_executions_system ON public.agent_executions`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_executions_select ON public.agent_executions`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_executions_insert ON public.agent_executions`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_executions_update ON public.agent_executions`.execute(db);

  await sql`DROP POLICY IF EXISTS agent_code_executions_system ON public.agent_code_executions`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_code_executions_select ON public.agent_code_executions`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_code_executions_insert ON public.agent_code_executions`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_code_executions_update ON public.agent_code_executions`.execute(db);

  await sql`DROP POLICY IF EXISTS agent_tool_calls_system ON public.agent_tool_calls`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_tool_calls_select ON public.agent_tool_calls`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_tool_calls_insert ON public.agent_tool_calls`.execute(db);
  await sql`DROP POLICY IF EXISTS agent_tool_calls_update ON public.agent_tool_calls`.execute(db);

  await sql`ALTER TABLE public.users DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.groups DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.roles DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.permissions DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.user_groups DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.user_roles DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.group_roles DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.role_permissions DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.accounts DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.sessions DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.settings DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.chat_sessions DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.chat_messages DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.chat_session_vfs DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.llm_providers DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.llm_provider_access DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.mcp_servers DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.mcp_server_access DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.skills DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.skill_access DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agents DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_access DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_mcp_servers DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_skills DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.triage_specialists DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_executions DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_code_executions DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.agent_tool_calls DISABLE ROW LEVEL SECURITY`.execute(db);

  await sql`DROP FUNCTION IF EXISTS auth.agent_has_linked_resource(UUID, TEXT, UUID)`.execute(db);
  await sql`DROP FUNCTION IF EXISTS auth.has_access(TEXT, UUID, TEXT[])`.execute(db);
  await sql`DROP FUNCTION IF EXISTS auth.is_owner(TEXT, UUID)`.execute(db);
  await sql`DROP FUNCTION IF EXISTS auth.can_any(TEXT[])`.execute(db);
  await sql`DROP FUNCTION IF EXISTS auth.can_any_with_perms(TEXT[], TEXT[])`.execute(db);
  await sql`DROP FUNCTION IF EXISTS auth.can(TEXT[])`.execute(db);
  await sql`DROP FUNCTION IF EXISTS auth.can_with_perms(TEXT[], TEXT[])`.execute(db);
  await sql`DROP FUNCTION IF EXISTS auth.user_permissions()`.execute(db);
  await sql`DROP FUNCTION IF EXISTS auth.user_groups()`.execute(db);
  await sql`DROP FUNCTION IF EXISTS auth.user_id()`.execute(db);

  await db.schema.dropSchema("auth").ifExists().cascade().execute();

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
