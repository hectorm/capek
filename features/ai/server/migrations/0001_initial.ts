import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "#layers/core/shared/schema";
import { AgentResource, LlmProviderResource, McpServerResource, SkillResource } from "#layers/ai/server/lib/resources";
import { createAccessTable, naturalCollation } from "#layers/core/server/lib/database/schema";

export const up = async (db: Kysely<Database>): Promise<void> => {
  const naturalCs = await naturalCollation(db);

  ////////////////////////////////

  await db.schema
    .createTable("public.aiChatSessions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("cascade").notNull())
    .addColumn("agentId", "uuid")
    .addColumn("title", sql`varchar(500) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("aiChatSessionsUserIdUpdatedAtIdx")
    .on("public.aiChatSessions")
    .columns(["userId", "updatedAt"])
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.aiChatMessages")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("sessionId", "uuid", (col) => col.references("public.aiChatSessions.id").onDelete("cascade").notNull())
    .addColumn("role", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("content", sql`text COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("aiChatMessagesSessionIdCreatedAtIdx")
    .on("public.aiChatMessages")
    .columns(["sessionId", "createdAt"])
    .execute();

  await db.schema
    .createIndex("aiChatMessagesSessionRoleCreatedIdx")
    .on("public.aiChatMessages")
    .columns(["sessionId", "role", "createdAt"])
    .where(sql.ref("role"), "!=", sql.lit("app"))
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.aiChatSessionVfs")
    .addColumn("sessionId", "uuid", (col) =>
      col.primaryKey().references("public.aiChatSessions.id").onDelete("cascade"),
    )
    .addColumn("data", sql`bytea`, (col) => col.notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.aiLlmProviders")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("description", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("apiUrl", sql`text COLLATE "C"`, (col) => col.notNull())
    .addColumn("apiKey", sql`text COLLATE "C"`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("headers", "jsonb", (col) => col.defaultTo(sql`'[]'::jsonb`).notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("updatedAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex("aiLlmProvidersNameIdx").on("public.aiLlmProviders").column("name").execute();

  ////////////////////////////////
  await createAccessTable(db, LlmProviderResource);

  ////////////////////////////////

  await db.schema
    .createTable("public.aiMcpServers")
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

  await db.schema.createIndex("aiMcpServersNameIdx").on("public.aiMcpServers").column("name").execute();

  ////////////////////////////////
  await createAccessTable(db, McpServerResource);

  ////////////////////////////////

  await db.schema
    .createTable("public.aiSkills")
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

  await db.schema.createIndex("aiSkillsNameIdx").on("public.aiSkills").column("name").execute();

  ////////////////////////////////
  await createAccessTable(db, SkillResource);

  ////////////////////////////////

  await db.schema
    .createTable("public.aiAgents")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull().unique())
    .addColumn("description", sql`varchar(500) COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("instructions", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("greetingMessage", sql`text COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("type", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("llmProviderId", "uuid", (col) => col.references("public.aiLlmProviders.id").onDelete("restrict"))
    .addColumn("model", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("summaryModel", sql`varchar(100) COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo(sql`''`))
    .addColumn("codeInterpreter", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("toolProviders", sql`varchar(100)[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
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

  await db.schema.createIndex("aiAgentsNameIdx").on("public.aiAgents").column("name").execute();

  await db.schema.createIndex("aiAgentsTypeIdx").on("public.aiAgents").column("type").execute();

  await db.schema
    .createIndex("aiAgentsLlmProviderIdIdx")
    .on("public.aiAgents")
    .column("llmProviderId")
    .where(sql.ref("llmProviderId"), "is not", null)
    .execute();

  ////////////////////////////////
  await createAccessTable(db, AgentResource);

  ////////////////////////////////
  await db.schema
    .alterTable("public.aiAgents")
    .addCheckConstraint("ai_agents_type_check", sql`type IN ('triage', 'specialist')`)
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.aiAgentMcpServers")
    .addColumn("agentId", "uuid", (col) => col.references("public.aiAgents.id").onDelete("cascade").notNull())
    .addColumn("mcpServerId", "uuid", (col) => col.references("public.aiMcpServers.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("aiAgentMcpServersPk", ["agentId", "mcpServerId"])
    .execute();

  await db.schema
    .createIndex("aiAgentMcpServersServerIdIdx")
    .on("public.aiAgentMcpServers")
    .column("mcpServerId")
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.aiAgentSkills")
    .addColumn("agentId", "uuid", (col) => col.references("public.aiAgents.id").onDelete("cascade").notNull())
    .addColumn("skillId", "uuid", (col) => col.references("public.aiSkills.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("aiAgentSkillsPk", ["agentId", "skillId"])
    .execute();

  await db.schema.createIndex("aiAgentSkillsSkillIdIdx").on("public.aiAgentSkills").column("skillId").execute();

  ////////////////////////////////

  // Resources of other features are referenced by type instead of with a foreign key, since those features are optional
  await db.schema
    .createTable("public.aiAgentToolResources")
    .addColumn("agentId", "uuid", (col) => col.references("public.aiAgents.id").onDelete("cascade").notNull())
    .addColumn("resourceType", "varchar(100)", (col) => col.notNull())
    .addColumn("resourceId", "uuid", (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("aiAgentToolResourcesPk", ["agentId", "resourceType", "resourceId"])
    .execute();

  await db.schema
    .createIndex("aiAgentToolResourcesResourceIdx")
    .on("public.aiAgentToolResources")
    .columns(["resourceType", "resourceId"])
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.aiTriageSpecialists")
    .addColumn("triageAgentId", "uuid", (col) => col.references("public.aiAgents.id").onDelete("cascade").notNull())
    .addColumn("specialistAgentId", "uuid", (col) => col.references("public.aiAgents.id").onDelete("cascade").notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addPrimaryKeyConstraint("aiTriageSpecialistsPk", ["triageAgentId", "specialistAgentId"])
    .execute();

  await db.schema
    .createIndex("aiTriageSpecialistsSpecialistIdIdx")
    .on("public.aiTriageSpecialists")
    .column("specialistAgentId")
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.aiAgentExecutions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("sessionId", "uuid", (col) => col.references("public.aiChatSessions.id").onDelete("set null"))
    .addColumn("agentId", "uuid", (col) => col.references("public.aiAgents.id").onDelete("set null"))
    .addColumn("userId", "uuid", (col) => col.references("public.users.id").onDelete("set null"))
    .addColumn("status", sql`varchar(20) COLLATE ${naturalCs}`, (col) => col.notNull().defaultTo("pending"))
    .addColumn("inputMessageId", "uuid", (col) => col.references("public.aiChatMessages.id").onDelete("set null"))
    .addColumn("outputMessageId", "uuid", (col) => col.references("public.aiChatMessages.id").onDelete("set null"))
    .addColumn("startedAt", "timestamptz")
    .addColumn("lastActivityAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("completedAt", "timestamptz")
    .addColumn("errorMessage", sql`text COLLATE ${naturalCs}`)
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("aiAgentExecutionsSessionIdIdx")
    .on("public.aiAgentExecutions")
    .column("sessionId")
    .execute();

  await db.schema.createIndex("aiAgentExecutionsAgentIdIdx").on("public.aiAgentExecutions").column("agentId").execute();

  await db.schema
    .createIndex("aiAgentExecutionsUserStatusCreatedIdx")
    .on("public.aiAgentExecutions")
    .columns(["userId", "status", "createdAt"])
    .where(sql.ref("userId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("aiAgentExecutionsStatusLastActivityAtIdx")
    .on("public.aiAgentExecutions")
    .columns(["status", "lastActivityAt"])
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.aiAgentCodeExecutions")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("executionId", "uuid", (col) => col.references("public.aiAgentExecutions.id").onDelete("set null"))
    .addColumn("code", sql`text COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("reasoning", sql`text COLLATE ${naturalCs}`)
    .addColumn("result", "jsonb")
    .addColumn("logs", "jsonb")
    .addColumn("errorMessage", sql`text COLLATE ${naturalCs}`)
    .addColumn("executionMs", "integer", (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex("aiAgentCodeExecutionsExecutionIdIdx")
    .on("public.aiAgentCodeExecutions")
    .column("executionId")
    .execute();

  ////////////////////////////////

  await db.schema
    .createTable("public.aiAgentToolCalls")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("executionId", "uuid", (col) => col.references("public.aiAgentExecutions.id").onDelete("set null"))
    .addColumn("mcpServerId", "uuid", (col) => col.references("public.aiMcpServers.id").onDelete("set null"))
    .addColumn("skillId", "uuid", (col) => col.references("public.aiSkills.id").onDelete("set null"))
    .addColumn("toolProvider", sql`varchar(100) COLLATE "C"`)
    .addColumn("codeExecutionId", "uuid", (col) =>
      col.references("public.aiAgentCodeExecutions.id").onDelete("set null"),
    )
    .addColumn("toolName", sql`varchar(255) COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("arguments", sql`text COLLATE ${naturalCs}`, (col) => col.notNull())
    .addColumn("result", sql`text COLLATE ${naturalCs}`)
    .addColumn("errorMessage", sql`text COLLATE ${naturalCs}`)
    .addColumn("createdAt", "timestamptz", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("completedAt", "timestamptz")
    .execute();

  await db.schema
    .createIndex("ai_agent_tool_calls_execution_id_idx")
    .on("public.aiAgentToolCalls")
    .column("executionId")
    .execute();

  await db.schema
    .createIndex("ai_agent_tool_calls_mcp_server_created_idx")
    .on("public.aiAgentToolCalls")
    .columns(["mcpServerId", "createdAt"])
    .where(sql.ref("mcpServerId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("ai_agent_tool_calls_skill_id_idx")
    .on("public.aiAgentToolCalls")
    .column("skillId")
    .where(sql.ref("skillId"), "is not", null)
    .execute();

  await db.schema
    .createIndex("ai_agent_tool_calls_code_execution_id_idx")
    .on("public.aiAgentToolCalls")
    .column("codeExecutionId")
    .where(sql.ref("codeExecutionId"), "is not", null)
    .execute();

  ////////////////////////////////

  await db.schema
    .alterTable("public.aiChatSessions")
    .addForeignKeyConstraint("ai_chat_sessions_agent_id_fk", ["agentId"], "public.aiAgents", ["id"], (cb) =>
      cb.onDelete("set null"),
    )
    .execute();
};
