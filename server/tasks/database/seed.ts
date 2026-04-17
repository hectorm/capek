import cluster from "node:cluster";
import { existsSync, readFileSync } from "node:fs";

import { useRuntimeConfig } from "nitropack/runtime/config";
import { defineTask } from "nitropack/runtime/task";
import yaml from "yaml";
import { z } from "zod/v4";

import { AuthModes } from "~~/server/lib/authn/strategies";
import { syncRolePermissions } from "~~/server/lib/authn/sync";
import { useDb } from "~~/server/lib/database";
import { useLogger } from "~~/server/lib/logger";
import { parseSkillParameters } from "~~/server/lib/skills/validator";
import { AgentExecutorParametersSchema } from "~~/shared/agent";
import { HttpHeadersSchema } from "~~/shared/http";
import { MCPServerParametersSchema } from "~~/shared/mcp";
import { Permissions, RolePermissions, Roles } from "~~/shared/rbac";

const config = useRuntimeConfig();
const logger = useLogger();

const seedUserSchema = z.object({
  username: z.string().min(1).max(255).trim(),
  fullname: z.string().min(1).max(255).trim(),
  email: z.email({ pattern: z.regexes.unicodeEmail }).max(255).trim().toLowerCase(),
  roles: z.array(z.string().min(1).max(255).trim().toLowerCase()).max(255).default([]),
  groups: z.array(z.string().min(1).max(255).trim()).max(255).default([]),
});

const seedGroupSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(1000).trim().default(""),
  roles: z.array(z.string().min(1).max(255).trim().toLowerCase()).max(255).default([]),
});

const seedAccessSchema = z.object({
  users: z.array(z.string().min(1).max(255).trim()).max(255).default([]),
  groups: z.array(z.string().min(1).max(255).trim()).max(255).default([]),
});

const seedLLMProviderSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(1000).trim().default(""),
  apiUrl: z.url(),
  apiKey: z.string().max(1000).trim().default(""),
  headers: HttpHeadersSchema.optional(),
  access: z
    .object({ editors: seedAccessSchema, users: seedAccessSchema })
    .default({ editors: { users: [], groups: [] }, users: { users: [], groups: [] } }),
});

const seedMCPServerSchema = z
  .object({
    name: z.string().min(1).max(100).trim(),
    description: z.string().max(1000).trim().default(""),
    url: z.url(),
    headers: HttpHeadersSchema.optional(),
    stateful: z.boolean().default(false),
    access: z
      .object({ editors: seedAccessSchema, users: seedAccessSchema })
      .default({ editors: { users: [], groups: [] }, users: { users: [], groups: [] } }),
  })
  .extend(MCPServerParametersSchema.shape);

const seedSkillSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(1000).trim().default(""),
  documentation: z.string().max(100000).trim().optional(),
  code: z.string().max(100000).optional(),
  access: z
    .object({ editors: seedAccessSchema, users: seedAccessSchema })
    .default({ editors: { users: [], groups: [] }, users: { users: [], groups: [] } }),
});

const seedAgentSchema = z
  .object({
    name: z.string().min(1).max(100).trim(),
    description: z.string().max(500).trim().default(""),
    instructions: z.string().max(100000).trim().default(""),
    greetingMessage: z.string().max(10000).trim().default(""),
    type: z.enum(["triage", "specialist"]),
    llmProviderName: z.string().min(1).max(100).trim(),
    model: z.string().min(1).max(100).trim(),
    summaryModel: z.string().max(100).trim().default(""),
    specialists: z.array(z.string().min(1).max(100).trim()).max(100).default([]),
    mcpServers: z.array(z.string().min(1).max(100).trim()).max(100).default([]),
    skills: z.array(z.string().min(1).max(100).trim()).max(100).default([]),
    codeInterpreter: z.boolean().default(false),
    streaming: z.boolean().default(true),
    access: z
      .object({ editors: seedAccessSchema, users: seedAccessSchema })
      .default({ editors: { users: [], groups: [] }, users: { users: [], groups: [] } }),
  })
  .extend(AgentExecutorParametersSchema.shape);

const seedConfigSchema = z.object({
  users: z.array(seedUserSchema).max(10000).default([]),
  groups: z.array(seedGroupSchema).max(10000).default([]),
  llmProviders: z.array(seedLLMProviderSchema).max(1000).default([]),
  mcpServers: z.array(seedMCPServerSchema).max(1000).default([]),
  skills: z.array(seedSkillSchema).max(1000).default([]),
  agents: z.array(seedAgentSchema).max(1000).default([]),
});

// Substitutes ${VAR}, ${VAR:-default} and ${VAR-default} placeholders with environment variable values.
// Use $$ to produce a literal $ (e.g. $${VAR} becomes ${VAR} without substitution).
function expandEnvVars(content: string): string {
  return content
    .replace(/\$\$/g, "\x00")
    .replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:)?-(.*?))?\}/gs,
      (_, name: string, colon?: string, fallback?: string) => {
        return (colon && process.env[name] === "" ? undefined : process.env[name]) ?? fallback ?? "";
      },
    )
    .replace(/\x00/g, "$"); // eslint-disable-line no-control-regex
}

export default defineTask({
  meta: {
    name: "database:seed",
    description: "Seed database with initial data",
  },
  async run() {
    if (cluster.isWorker) {
      return { result: true };
    }

    logger.info("Starting database seeding task");

    try {
      const db = await useDb();

      await db
        .transaction()
        .setIsolationLevel("read committed")
        .execute(async (trx) => {
          // Create permissions
          const permissionNames = Object.values(Permissions);
          if (permissionNames.length > 0) {
            await trx
              .insertInto("permissions")
              .values(permissionNames.map((name) => ({ name })))
              .onConflict((oc) => oc.column("name").doNothing())
              .execute();
          }

          // Create roles
          const roleNames = Object.values(Roles);
          if (roleNames.length > 0) {
            await trx
              .insertInto("roles")
              .values(roleNames.map((name) => ({ name })))
              .onConflict((oc) => oc.column("name").doNothing())
              .execute();
          }

          // Apply permissions to roles
          for (const [roleName, rolePermissionNames] of Object.entries(RolePermissions)) {
            const role = await trx
              .selectFrom("roles")
              .select(["id", "name"])
              .where("name", "=", roleName)
              .executeTakeFirstOrThrow();

            await syncRolePermissions(role.id, rolePermissionNames as string[], trx);
          }
        });

      // Ensure single user exists and has admin role if in single user mode
      if (config.authMode === AuthModes.SingleUser) {
        await db
          .transaction()
          .setIsolationLevel("read committed")
          .execute(async (trx) => {
            let singleUser = await trx
              .selectFrom("users")
              .select(["id", "username", "email"])
              .where("username", "=", config.singleUser.username)
              .where("email", "=", config.singleUser.email)
              .executeTakeFirst();

            singleUser ??= await trx
              .insertInto("users")
              .values({
                username: config.singleUser.username,
                fullname: config.singleUser.fullname,
                email: config.singleUser.email,
              })
              .returning(["id", "username", "email"])
              .executeTakeFirstOrThrow();

            await trx
              .insertInto("userRoles")
              .values({
                userId: singleUser.id,
                roleId: trx.selectFrom("roles").select("id").where("name", "=", Roles.Admin),
              })
              .onConflict((oc) => oc.columns(["userId", "roleId"]).doNothing())
              .execute();
          });
      }

      // Seed resources from configuration
      if (config.seed.config) {
        let seedConfigRaw: unknown;
        if (typeof config.seed.config === "string") {
          const isPath = !/\n|^\s*[[{]/.test(config.seed.config) && existsSync(config.seed.config);
          const raw = isPath ? readFileSync(config.seed.config, "utf-8") : config.seed.config;
          seedConfigRaw = yaml.parse(expandEnvVars(raw));
        } else {
          seedConfigRaw = config.seed.config;
        }
        let seedConfig: z.infer<typeof seedConfigSchema>;
        try {
          seedConfig = seedConfigSchema.parse(seedConfigRaw);
        } catch (error) {
          logger.error({ error }, "Invalid seed configuration");
          throw new Error("Seed configuration validation failed");
        }

        if (Object.keys(seedConfig).length === 0) {
          return { result: true };
        }

        logger.info("Starting resource seeding from configuration");

        async function resolveUser(username: string): Promise<string> {
          const user = await db.selectFrom("users").where("username", "=", username).select("id").executeTakeFirst();
          if (!user) {
            throw new Error(`User "${username}" not found`);
          }
          return user.id;
        }

        async function resolveGroup(groupname: string): Promise<string> {
          const group = await db.selectFrom("groups").where("name", "=", groupname).select("id").executeTakeFirst();
          if (!group) {
            throw new Error(`Group "${groupname}" not found`);
          }
          return group.id;
        }

        // 1. Seed users (idempotent by username)
        const userIds = new Map<string, string>();
        for (const userConfig of seedConfig.users) {
          const existing = await db
            .selectFrom("users")
            .where("username", "=", userConfig.username)
            .select("id")
            .executeTakeFirst();

          if (existing) {
            logger.info(`User "${userConfig.username}" already exists, skipping`);
            userIds.set(userConfig.username, existing.id);
          } else {
            const user = await db
              .insertInto("users")
              .values({
                username: userConfig.username,
                fullname: userConfig.fullname,
                email: userConfig.email,
              })
              .returning(["id", "username"])
              .executeTakeFirstOrThrow();

            logger.info(`Created user: ${user.username}`);
            userIds.set(user.username, user.id);

            // Assign roles to user
            for (const roleName of userConfig.roles) {
              const role = await db.selectFrom("roles").where("name", "=", roleName).select("id").executeTakeFirst();
              if (!role) {
                logger.warn(`Role "${roleName}" not found, skipping assignment`);
                continue;
              }

              await db
                .insertInto("userRoles")
                .values({ userId: user.id, roleId: role.id })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Assigned role "${roleName}" to user "${user.username}"`);
            }
          }
        }

        // 2. Seed groups (idempotent by name)
        const groupIds = new Map<string, string>();
        for (const groupConfig of seedConfig.groups) {
          const existing = await db
            .selectFrom("groups")
            .where("name", "=", groupConfig.name)
            .select("id")
            .executeTakeFirst();

          if (existing) {
            logger.info(`Group "${groupConfig.name}" already exists, skipping`);
            groupIds.set(groupConfig.name, existing.id);
          } else {
            const group = await db
              .insertInto("groups")
              .values({
                name: groupConfig.name,
                description: groupConfig.description,
              })
              .returning(["id", "name"])
              .executeTakeFirstOrThrow();

            logger.info(`Created group: ${group.name}`);
            groupIds.set(group.name, group.id);

            // Assign roles to group
            for (const roleName of groupConfig.roles) {
              const role = await db.selectFrom("roles").where("name", "=", roleName).select("id").executeTakeFirst();
              if (!role) {
                logger.warn(`Role "${roleName}" not found, skipping assignment`);
                continue;
              }

              await db
                .insertInto("groupRoles")
                .values({ groupId: group.id, roleId: role.id })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Assigned role "${roleName}" to group "${group.name}"`);
            }
          }
        }

        // 2b. Add users to groups
        for (const userConfig of seedConfig.users) {
          const userId = userIds.get(userConfig.username);
          if (!userId) {
            continue; // User already existed, skip group assignment
          }

          for (const groupname of userConfig.groups) {
            const groupId = groupIds.get(groupname);
            if (!groupId) {
              // Try to find group in database (might have been created in previous run)
              const group = await db.selectFrom("groups").where("name", "=", groupname).select("id").executeTakeFirst();
              if (!group) {
                logger.warn(`Group "${groupname}" not found, skipping membership for user "${userConfig.username}"`);
                continue;
              }
              groupIds.set(groupname, group.id);
            }

            const resolvedGroupId = groupIds.get(groupname);
            if (!resolvedGroupId) {
              throw new Error(`Group ID not found for "${groupname}"`);
            }

            await db
              .insertInto("userGroups")
              .values({ userId: userId, groupId: resolvedGroupId })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Added user "${userConfig.username}" to group "${groupname}"`);
          }
        }

        // 3. Seed LLM providers (idempotent by name)
        const llmProviderIds = new Map<string, string>();
        for (const llmProviderConfig of seedConfig.llmProviders) {
          const existing = await db
            .selectFrom("llmProviders")
            .where("name", "=", llmProviderConfig.name)
            .select("id")
            .executeTakeFirst();

          if (existing) {
            logger.info(`LLM provider "${llmProviderConfig.name}" already exists, skipping`);
            llmProviderIds.set(llmProviderConfig.name, existing.id);
          } else {
            const llmProvider = await db
              .insertInto("llmProviders")
              .values({
                name: llmProviderConfig.name,
                description: llmProviderConfig.description,
                apiUrl: llmProviderConfig.apiUrl,
                apiKey: llmProviderConfig.apiKey,
                headers: JSON.stringify(llmProviderConfig.headers ?? []),
              })
              .returning(["id", "name"])
              .executeTakeFirstOrThrow();

            logger.info(`Created LLM provider: ${llmProvider.name}`);
            llmProviderIds.set(llmProvider.name, llmProvider.id);

            // Grant access to editors
            for (const username of llmProviderConfig.access.editors.users) {
              const userId = await resolveUser(username);
              await db
                .insertInto("llmProviderAccess")
                .values({ llmProviderId: llmProvider.id, userId, groupId: null, role: "editor" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted editor access to user: ${username}`);
            }

            for (const groupname of llmProviderConfig.access.editors.groups) {
              const groupId = await resolveGroup(groupname);
              await db
                .insertInto("llmProviderAccess")
                .values({ llmProviderId: llmProvider.id, userId: null, groupId, role: "editor" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted editor access to group: ${groupname}`);
            }

            // Grant access to users
            for (const username of llmProviderConfig.access.users.users) {
              const userId = await resolveUser(username);
              await db
                .insertInto("llmProviderAccess")
                .values({ llmProviderId: llmProvider.id, userId, groupId: null, role: "user" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted user access to user: ${username}`);
            }

            for (const groupname of llmProviderConfig.access.users.groups) {
              const groupId = await resolveGroup(groupname);
              await db
                .insertInto("llmProviderAccess")
                .values({ llmProviderId: llmProvider.id, userId: null, groupId, role: "user" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted user access to group: ${groupname}`);
            }
          }
        }

        // 4. Seed MCP servers (idempotent by name)
        const mcpServerIds = new Map<string, string>();
        for (const mcpConfig of seedConfig.mcpServers) {
          const existing = await db
            .selectFrom("mcpServers")
            .where("name", "=", mcpConfig.name)
            .select("id")
            .executeTakeFirst();

          if (existing) {
            logger.info(`MCP server "${mcpConfig.name}" already exists, skipping`);
            mcpServerIds.set(mcpConfig.name, existing.id);
          } else {
            const mcpServer = await db
              .insertInto("mcpServers")
              .values({
                name: mcpConfig.name,
                description: mcpConfig.description,
                url: mcpConfig.url,
                headers: JSON.stringify(mcpConfig.headers ?? []),
                stateful: mcpConfig.stateful,
                toolCallTimeoutSec: mcpConfig.toolCallTimeoutSec ?? null,
                cachedTools: "[]",
              })
              .returning(["id", "name"])
              .executeTakeFirstOrThrow();

            logger.info(`Created MCP server: ${mcpServer.name} (tools will be discovered on first use)`);
            mcpServerIds.set(mcpServer.name, mcpServer.id);

            // Grant access to editors
            for (const username of mcpConfig.access.editors.users) {
              const userId = await resolveUser(username);
              await db
                .insertInto("mcpServerAccess")
                .values({ mcpServerId: mcpServer.id, userId, groupId: null, role: "editor" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted editor access to user: ${username}`);
            }

            for (const groupname of mcpConfig.access.editors.groups) {
              const groupId = await resolveGroup(groupname);
              await db
                .insertInto("mcpServerAccess")
                .values({ mcpServerId: mcpServer.id, userId: null, groupId, role: "editor" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted editor access to group: ${groupname}`);
            }

            // Grant access to users
            for (const username of mcpConfig.access.users.users) {
              const userId = await resolveUser(username);
              await db
                .insertInto("mcpServerAccess")
                .values({ mcpServerId: mcpServer.id, userId, groupId: null, role: "user" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted user access to user: ${username}`);
            }

            for (const groupname of mcpConfig.access.users.groups) {
              const groupId = await resolveGroup(groupname);
              await db
                .insertInto("mcpServerAccess")
                .values({ mcpServerId: mcpServer.id, userId: null, groupId, role: "user" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted user access to group: ${groupname}`);
            }
          }
        }

        // 5. Seed skills (idempotent by name)
        const skillIds = new Map<string, string>();
        for (const skillConfig of seedConfig.skills) {
          const existing = await db
            .selectFrom("skills")
            .where("name", "=", skillConfig.name)
            .select("id")
            .executeTakeFirst();

          if (existing) {
            logger.info(`Skill "${skillConfig.name}" already exists, skipping`);
            skillIds.set(skillConfig.name, existing.id);
          } else {
            const jsdocParsed = skillConfig.code ? parseSkillParameters(skillConfig.code) : null;
            const parameters = jsdocParsed?.parameters ?? { type: "object" as const, properties: {} };

            const skill = await db
              .insertInto("skills")
              .values({
                name: skillConfig.name,
                description: skillConfig.description,
                documentation: skillConfig.documentation ?? null,
                parameters: JSON.stringify(parameters),
                code: skillConfig.code ?? null,
              })
              .returning(["id", "name"])
              .executeTakeFirstOrThrow();

            logger.info(`Created skill: ${skill.name}`);
            skillIds.set(skill.name, skill.id);

            // Grant access to editors
            for (const username of skillConfig.access.editors.users) {
              const userId = await resolveUser(username);
              await db
                .insertInto("skillAccess")
                .values({ skillId: skill.id, userId, groupId: null, role: "editor" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted editor access to user: ${username}`);
            }

            for (const groupname of skillConfig.access.editors.groups) {
              const groupId = await resolveGroup(groupname);
              await db
                .insertInto("skillAccess")
                .values({ skillId: skill.id, userId: null, groupId, role: "editor" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted editor access to group: ${groupname}`);
            }

            // Grant access to users
            for (const username of skillConfig.access.users.users) {
              const userId = await resolveUser(username);
              await db
                .insertInto("skillAccess")
                .values({ skillId: skill.id, userId, groupId: null, role: "user" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted user access to user: ${username}`);
            }

            for (const groupname of skillConfig.access.users.groups) {
              const groupId = await resolveGroup(groupname);
              await db
                .insertInto("skillAccess")
                .values({ skillId: skill.id, userId: null, groupId, role: "user" })
                .onConflict((oc) => oc.doNothing())
                .execute();
              logger.info(`Granted user access to group: ${groupname}`);
            }
          }
        }

        // 6. Seed agents (idempotent by name)
        const agentIds = new Map<string, string>();
        for (const agentConfig of seedConfig.agents) {
          const existing = await db
            .selectFrom("agents")
            .where("name", "=", agentConfig.name)
            .select("id")
            .executeTakeFirst();

          if (existing) {
            logger.info(`Agent "${agentConfig.name}" already exists, skipping`);
            agentIds.set(agentConfig.name, existing.id);
            continue;
          }

          // Resolve LLM provider ID
          const llmProviderId = llmProviderIds.get(agentConfig.llmProviderName);
          if (!llmProviderId) {
            throw new Error(`LLM provider "${agentConfig.llmProviderName}" not found for agent "${agentConfig.name}"`);
          }

          // Create agent
          const agent = await db
            .insertInto("agents")
            .values({
              name: agentConfig.name,
              description: agentConfig.description,
              instructions: agentConfig.instructions,
              greetingMessage: agentConfig.greetingMessage,
              type: agentConfig.type,
              llmProviderId,
              model: agentConfig.model,
              summaryModel: agentConfig.summaryModel,
              codeInterpreter: agentConfig.type === "specialist" ? agentConfig.codeInterpreter : false,
              streaming: agentConfig.streaming,
              temperature: agentConfig.temperature ?? null,
              maxTokens: agentConfig.maxTokens ?? null,
              topP: agentConfig.topP ?? null,
              frequencyPenalty: agentConfig.frequencyPenalty ?? null,
              presencePenalty: agentConfig.presencePenalty ?? null,
              maxIterations: agentConfig.maxIterations ?? null,
              timeoutSec: agentConfig.timeoutSec ?? null,
              maxContextChars: agentConfig.maxContextChars ?? null,
              maxToolResponseChars: agentConfig.maxToolResponseChars ?? null,
            })
            .returning(["id", "name", "type"])
            .executeTakeFirstOrThrow();

          logger.info(`Created agent: ${agent.name} (${agent.type})`);
          agentIds.set(agent.name, agent.id);

          // Assign MCP servers to agent
          for (const mcpName of agentConfig.mcpServers) {
            const mcpServerId = mcpServerIds.get(mcpName);
            if (!mcpServerId) {
              logger.warn(`MCP server "${mcpName}" not found for agent "${agentConfig.name}"`);
              continue;
            }
            await db
              .insertInto("agentMcpServers")
              .values({ agentId: agent.id, mcpServerId })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Assigned MCP server "${mcpName}" to agent "${agent.name}"`);
          }

          // Assign skills to agent
          for (const skillName of agentConfig.skills) {
            const skillId = skillIds.get(skillName);
            if (!skillId) {
              logger.warn(`Skill "${skillName}" not found for agent "${agentConfig.name}"`);
              continue;
            }
            await db
              .insertInto("agentSkills")
              .values({ agentId: agent.id, skillId })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Assigned skill "${skillName}" to agent "${agent.name}"`);
          }

          // Grant access to editors
          for (const username of agentConfig.access.editors.users) {
            const userId = await resolveUser(username);
            await db
              .insertInto("agentAccess")
              .values({ agentId: agent.id, userId, groupId: null, role: "editor" })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Granted editor access to user: ${username}`);
          }

          for (const groupname of agentConfig.access.editors.groups) {
            const groupId = await resolveGroup(groupname);
            await db
              .insertInto("agentAccess")
              .values({
                agentId: agent.id,
                userId: null,
                groupId: groupId,
                role: "editor",
              })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Granted editor access to group: ${groupname}`);
          }

          // Grant access to users
          for (const username of agentConfig.access.users.users) {
            const userId = await resolveUser(username);
            await db
              .insertInto("agentAccess")
              .values({ agentId: agent.id, userId, groupId: null, role: "user" })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Granted user access to user: ${username}`);
          }

          for (const groupname of agentConfig.access.users.groups) {
            const groupId = await resolveGroup(groupname);
            await db
              .insertInto("agentAccess")
              .values({ agentId: agent.id, userId: null, groupId: groupId, role: "user" })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Granted user access to group: ${groupname}`);
          }
        }

        // 7. Assign specialists to triage agents
        for (const agentConfig of seedConfig.agents) {
          if (agentConfig.type !== "triage" || agentConfig.specialists.length === 0) {
            continue;
          }

          const triageId = agentIds.get(agentConfig.name);
          if (!triageId) {
            continue; // Already existed, skip
          }

          for (const specialistName of agentConfig.specialists) {
            const specialistId = agentIds.get(specialistName);
            if (!specialistId) {
              logger.warn(
                `Specialist agent "${specialistName}" not found, skipping assignment to triage "${agentConfig.name}"`,
              );
              continue;
            }

            await db
              .insertInto("triageSpecialists")
              .values({ triageAgentId: triageId, specialistAgentId: specialistId })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Assigned specialist "${specialistName}" to triage "${agentConfig.name}"`);
          }
        }

        logger.info("Resource seeding completed successfully");
      }

      logger.info("Database seeding completed");
      return { result: true };
    } catch (error) {
      logger.error({ error }, "Database seeding failed");
      return { result: false, error };
    }
  },
});
