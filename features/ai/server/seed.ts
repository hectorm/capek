import { sql } from "kysely";
import { z } from "zod/v4";

import { AgentResource, LlmProviderResource, McpServerResource, SkillResource } from "#layers/ai/server/lib/resources";
import { encryptLlmProviderSecrets, encryptMcpServerHeaders } from "#layers/ai/server/lib/secrets";
import { parseSkillParameters } from "#layers/ai/server/lib/skills/validator";
import { AgentExecutorParametersSchema } from "#layers/ai/shared/agent";
import { LlmProviderApiTypeSchema } from "#layers/ai/shared/llmProvider";
import { MCPServerParametersSchema } from "#layers/ai/shared/mcp";
import { listResources } from "#layers/core/server/lib/authz/resources";
import { defineSeed, seedAccessSchema } from "#layers/core/server/lib/seed";
import { collectToolProviders, hasToolResources } from "#layers/core/server/lib/tools/define";
import { HttpHeadersSchema, HttpUrlSchema } from "#layers/core/shared/http";

const seedLLMProviderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).trim().default(""),
  apiUrl: HttpUrlSchema,
  apiType: LlmProviderApiTypeSchema.default("chat-completions"),
  apiKey: z.string().max(1000).trim().default(""),
  headers: HttpHeadersSchema.optional(),
  access: seedAccessSchema,
});

const seedMCPServerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).trim().default(""),
    url: HttpUrlSchema,
    headers: HttpHeadersSchema.optional(),
    stateful: z.boolean().default(false),
    access: seedAccessSchema,
  })
  .extend(MCPServerParametersSchema.shape);

const seedSkillSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).trim().default(""),
  documentation: z.string().max(100000).trim().optional(),
  code: z.string().max(100000).optional(),
  access: seedAccessSchema,
});

const seedAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).trim().default(""),
    instructions: z.string().max(100000).trim().default(""),
    greetingMessage: z.string().max(10000).trim().default(""),
    priority: z.number().int().min(-1000).max(1000).default(0),
    type: z.enum(["triage", "specialist"]),
    llmProvider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    summaryModel: z.string().max(100).trim().default(""),
    reasoningEffort: z.string().max(20).trim().default(""),
    specialists: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    mcpServers: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    skills: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    tools: z
      .record(
        z.string().min(1).max(100),
        z.union([z.literal(true), z.array(z.string().trim().min(1).max(255)).max(100)]),
      )
      .default({}),
    codeInterpreter: z.boolean().default(false),
    showToolCalls: z.boolean().default(true),
    streaming: z.boolean().default(true),
    access: seedAccessSchema,
  })
  .extend(AgentExecutorParametersSchema.shape);

export const aiSeed = defineSeed({
  schema: {
    llmProviders: z.array(seedLLMProviderSchema).max(1000).default([]),
    mcpServers: z.array(seedMCPServerSchema).max(1000).default([]),
    skills: z.array(seedSkillSchema).max(1000).default([]),
    agents: z.array(seedAgentSchema).max(1000).default([]),
  },
  async run(config, { db, logger, features, grantAccess, defer }) {
    // Seed LLM providers (idempotent by name)
    const llmProviderIds = new Map<string, string>();
    for (const llmProviderConfig of config.llmProviders) {
      const existing = await db
        .selectFrom("aiLlmProviders")
        .where("name", "=", llmProviderConfig.name)
        .select("id")
        .executeTakeFirst();

      if (existing) {
        logger.info(`LLM provider "${llmProviderConfig.name}" already exists, skipping`);
        llmProviderIds.set(llmProviderConfig.name, existing.id);
      } else {
        const llmProvider = await db
          .insertInto("aiLlmProviders")
          .values({
            name: llmProviderConfig.name,
            description: llmProviderConfig.description,
            apiUrl: llmProviderConfig.apiUrl,
            apiType: llmProviderConfig.apiType,
            ...encryptLlmProviderSecrets({
              apiKey: llmProviderConfig.apiKey,
              headers: llmProviderConfig.headers ?? [],
            }),
          })
          .returning(["id", "name"])
          .executeTakeFirstOrThrow();

        logger.info(`Created LLM provider: ${llmProvider.name}`);
        llmProviderIds.set(llmProvider.name, llmProvider.id);

        await grantAccess(LlmProviderResource, llmProvider.id, llmProviderConfig.access);
      }
    }

    // Seed MCP servers (idempotent by name)
    const mcpServerIds = new Map<string, string>();
    for (const mcpConfig of config.mcpServers) {
      const existing = await db
        .selectFrom("aiMcpServers")
        .where("name", "=", mcpConfig.name)
        .select("id")
        .executeTakeFirst();

      if (existing) {
        logger.info(`MCP server "${mcpConfig.name}" already exists, skipping`);
        mcpServerIds.set(mcpConfig.name, existing.id);
      } else {
        const mcpServer = await db
          .insertInto("aiMcpServers")
          .values({
            name: mcpConfig.name,
            description: mcpConfig.description,
            url: mcpConfig.url,
            headers: encryptMcpServerHeaders(mcpConfig.headers ?? []),
            stateful: mcpConfig.stateful,
            toolCallTimeoutSec: mcpConfig.toolCallTimeoutSec ?? null,
            cachedTools: "[]",
          })
          .returning(["id", "name"])
          .executeTakeFirstOrThrow();

        logger.info(`Created MCP server: ${mcpServer.name} (tools will be discovered on first use)`);
        mcpServerIds.set(mcpServer.name, mcpServer.id);

        await grantAccess(McpServerResource, mcpServer.id, mcpConfig.access);
      }
    }

    // Seed skills (idempotent by name)
    const skillIds = new Map<string, string>();
    for (const skillConfig of config.skills) {
      const existing = await db
        .selectFrom("aiSkills")
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
          .insertInto("aiSkills")
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

        await grantAccess(SkillResource, skill.id, skillConfig.access);
      }
    }

    // Seed agents (idempotent by name)
    const agentIds = new Map<string, string>();
    const providers = collectToolProviders(features);
    for (const agentConfig of config.agents) {
      const existing = await db
        .selectFrom("aiAgents")
        .where("name", "=", agentConfig.name)
        .select("id")
        .executeTakeFirst();

      if (existing) {
        logger.info(`Agent "${agentConfig.name}" already exists, skipping`);
        agentIds.set(agentConfig.name, existing.id);
        continue;
      }

      // Resolve LLM provider ID
      const llmProviderId = llmProviderIds.get(agentConfig.llmProvider);
      if (!llmProviderId) {
        throw new Error(`LLM provider "${agentConfig.llmProvider}" not found for agent "${agentConfig.name}"`);
      }

      // Create agent
      const agent = await db
        .insertInto("aiAgents")
        .values({
          name: agentConfig.name,
          description: agentConfig.description,
          instructions: agentConfig.instructions,
          greetingMessage: agentConfig.greetingMessage,
          priority: agentConfig.priority,
          type: agentConfig.type,
          llmProviderId,
          model: agentConfig.model,
          summaryModel: agentConfig.summaryModel,
          reasoningEffort: agentConfig.reasoningEffort,
          codeInterpreter: agentConfig.type === "specialist" ? agentConfig.codeInterpreter : false,
          showToolCalls: agentConfig.showToolCalls,
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
          maxToolPartsChars: agentConfig.maxToolPartsChars ?? null,
        })
        .returning(["id", "name", "type"])
        .executeTakeFirstOrThrow();

      logger.info(`Created agent: ${agent.name} (${agent.type})`);
      agentIds.set(agent.name, agent.id);

      // Assign MCP servers to agent
      for (const mcpName of agentConfig.mcpServers) {
        const mcpServerId = mcpServerIds.get(mcpName);
        if (!mcpServerId) {
          throw new Error(`MCP server "${mcpName}" not found for agent "${agentConfig.name}"`);
        }
        await db
          .insertInto("aiAgentMcpServers")
          .values({ agentId: agent.id, mcpServerId })
          .onConflict((oc) => oc.doNothing())
          .execute();
        logger.info(`Assigned MCP server "${mcpName}" to agent "${agent.name}"`);
      }

      // Assign skills to agent
      for (const skillName of agentConfig.skills) {
        const skillId = skillIds.get(skillName);
        if (!skillId) {
          throw new Error(`Skill "${skillName}" not found for agent "${agentConfig.name}"`);
        }
        await db
          .insertInto("aiAgentSkills")
          .values({ agentId: agent.id, skillId })
          .onConflict((oc) => oc.doNothing())
          .execute();
        logger.info(`Assigned skill "${skillName}" to agent "${agent.name}"`);
      }

      await grantAccess(AgentResource, agent.id, agentConfig.access);

      // Assign specialists to triage agents
      if (agentConfig.type === "triage") {
        defer(async () => {
          for (const specialistName of agentConfig.specialists) {
            const specialistId = agentIds.get(specialistName);
            if (!specialistId) {
              throw new Error(`Specialist agent "${specialistName}" not found for triage "${agentConfig.name}"`);
            }
            await db
              .insertInto("aiTriageSpecialists")
              .values({ triageAgentId: agent.id, specialistAgentId: specialistId })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Assigned specialist "${specialistName}" to triage "${agentConfig.name}"`);
          }
        });
      }

      // Give the tools of other features to the agents
      defer(async () => {
        for (const [providerName, resourceNames] of Object.entries(agentConfig.tools)) {
          const provider = providers.find((candidate) => candidate.name === providerName);
          if (!provider) {
            throw new Error(`Tool provider "${providerName}" not found for agent "${agentConfig.name}"`);
          }

          if (resourceNames === true) {
            if (hasToolResources(provider)) {
              throw new Error(
                `Tool provider "${providerName}" of agent "${agentConfig.name}" needs the names of its resources`,
              );
            }
            await db
              .updateTable("aiAgents")
              .set({ toolProviders: sql<string[]>`array_append(tool_providers, ${providerName}::VARCHAR)` })
              .where("id", "=", agent.id)
              .where(sql<boolean>`NOT (${providerName} = ANY(tool_providers))`)
              .execute();
            logger.info(`Switched on "${providerName}" for agent "${agentConfig.name}"`);
            continue;
          }
          if (!hasToolResources(provider)) {
            throw new Error(
              `Tool provider "${providerName}" of agent "${agentConfig.name}" has no resources to assign`,
            );
          }

          const resources = await listResources(db, provider.resource, { names: resourceNames });
          for (const resourceName of resourceNames) {
            const resource = resources.find((candidate) => candidate.name === resourceName);
            if (!resource) {
              throw new Error(
                `Resource "${resourceName}" of "${providerName}" not found for agent "${agentConfig.name}"`,
              );
            }
            await db
              .insertInto("aiAgentToolResources")
              .values({ agentId: agent.id, resourceType: provider.resource.type, resourceId: resource.id })
              .onConflict((oc) => oc.doNothing())
              .execute();
            logger.info(`Assigned "${resourceName}" of "${providerName}" to agent "${agentConfig.name}"`);
          }
        }
      });
    }
  },
});
