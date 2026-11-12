import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { LlmClient } from "#layers/ai/server/lib/llm/client";
import { AgentResource } from "#layers/ai/server/lib/resources";
import { syncAgentToolResources } from "#layers/ai/server/lib/tools";
import { AgentExecutorParametersSchema } from "#layers/ai/shared/agent";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { canAny } from "#layers/core/server/lib/authz/permissions";
import { grantResourceAccess, listResources } from "#layers/core/server/lib/authz/resources";
import { useDb, withUserTransaction } from "#layers/core/server/lib/database";
import { isForeignKeyViolation, isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { syncLinks } from "#layers/core/server/lib/database/links";
import { PageCursorSchema, paginate } from "#layers/core/server/lib/database/pagination";
import { getToolProviders } from "#layers/core/server/lib/tools";
import { hasToolResources } from "#layers/core/server/lib/tools/define";
import { sharedResourceAccessProcedures } from "#layers/core/server/trpc/access";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";

// Only the tool providers without resources to assign can be switched on for an agent
const checkSwitchableToolProviders = (names: readonly string[]): string[] => {
  const switchable = getToolProviders()
    .filter((provider) => !hasToolResources(provider))
    .map((provider) => provider.name);
  const unknown = names.find((name) => !switchable.includes(name));
  if (unknown !== undefined) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Tool provider "${unknown}" cannot be switched on`,
    });
  }
  return [...new Set(names)];
};

const findResourceToolProvider = (name: string) => {
  const provider = getToolProviders().find((candidate) => candidate.name === name);
  if (!provider || !hasToolResources(provider)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Tool provider not found",
    });
  }
  return provider;
};

export const agentRouter = createTRPCRouter({
  read: authorizedProcedure([AiPermissions.AgentReadAll, AiPermissions.AgentReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const agent = await withUserTransaction(ctx.user, async (trx) => {
        return trx
          .selectFrom("aiAgents")
          .select([
            "id",
            "name",
            "description",
            "instructions",
            "greetingMessage",
            "priority",
            "type",
            "llmProviderId",
            "model",
            "summaryModel",
            "reasoningEffort",
            "codeInterpreter",
            "showToolCalls",
            "toolProviders",
            "streaming",
            "temperature",
            "maxTokens",
            "topP",
            "frequencyPenalty",
            "presencePenalty",
            "maxIterations",
            "timeoutSec",
            "maxContextChars",
            "maxToolResponseChars",
            "maxToolPartsChars",
          ])
          .where("id", "=", input.id)
          .executeTakeFirst();
      });

      if (!agent) {
        ctx.logger.warn({ agentId: input.id }, "Agent not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }

      let llmProviderName: string | null = null;
      if (agent.llmProviderId) {
        // Agent access was verified above, resolve the linked provider in system context
        // eslint-disable-next-line no-restricted-syntax
        const db = await useDb();
        const llmProvider = await db
          .selectFrom("aiLlmProviders")
          .select(["name"])
          .where("id", "=", agent.llmProviderId)
          .executeTakeFirst();
        llmProviderName = llmProvider?.name ?? null;
      }

      ctx.logger.debug({ agentId: input.id }, "Agent retrieved");
      return { ...agent, llmProviderName };
    }),

  search: authorizedProcedure([AiPermissions.AgentListAll, AiPermissions.AgentListOwn])
    .input(
      z.object({
        type: z.enum(["triage", "specialist"]).optional(),
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["name", "description", "type", "model"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description", "type", "model", "priority"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: PageCursorSchema.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order, type } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx
          .selectFrom("aiAgents")
          .select([
            "aiAgents.id",
            "aiAgents.name",
            "aiAgents.description",
            "aiAgents.type",
            "aiAgents.model",
            "aiAgents.priority",
          ]);

        if (type) {
          query = query.where("aiAgents.type", "=", type);
        }

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb(`aiAgents.${searchBy}`, "ilike", `%${v}%`))));
        }

        const { rows: agents, nextCursor } = await paginate(query, {
          table: "aiAgents",
          orderBy,
          order,
          limit,
          cursor,
        });

        ctx.logger.debug("Agent list retrieved");
        return { agents, nextCursor };
      });
    }),

  create: authorizedProcedure([AiPermissions.AgentCreate])
    .input(
      z
        .object({
          name: z.string().trim().min(1).max(100),
          description: z.string().max(500).trim().default(""),
          instructions: z.string().max(100000).trim().default(""),
          greetingMessage: z.string().max(10000).trim().default(""),
          priority: z.number().int().min(-1000).max(1000).default(0),
          type: z.enum(["triage", "specialist"]),
          llmProviderId: z.uuid().nullish(),
          model: z.string().trim().min(1).max(100),
          summaryModel: z.string().max(100).trim().default(""),
          reasoningEffort: z.string().max(20).trim().default(""),
          codeInterpreter: z.boolean().default(false),
          showToolCalls: z.boolean().default(true),
          toolProviders: z.array(z.string().min(1).max(100)).max(100).default([]),
          streaming: z.boolean().default(true),
        })
        .extend(AgentExecutorParametersSchema.shape),
    )
    .mutation(async ({ ctx, input }) => {
      const toolProviders = input.type === "specialist" ? checkSwitchableToolProviders(input.toolProviders) : [];

      const agent = await withUserTransaction(ctx.user, async (trx) => {
        try {
          const agentId = crypto.randomUUID();

          await trx
            .insertInto("aiAgents")
            .values({
              id: agentId,
              name: input.name,
              description: input.description,
              instructions: input.instructions,
              greetingMessage: input.greetingMessage,
              priority: input.priority,
              type: input.type,
              llmProviderId: input.llmProviderId ?? null,
              model: input.model,
              summaryModel: input.summaryModel,
              reasoningEffort: input.reasoningEffort,
              codeInterpreter: input.type === "specialist" ? input.codeInterpreter : false,
              showToolCalls: input.showToolCalls,
              toolProviders,
              streaming: input.streaming,
              temperature: input.temperature ?? null,
              maxTokens: input.maxTokens ?? null,
              topP: input.topP ?? null,
              frequencyPenalty: input.frequencyPenalty ?? null,
              presencePenalty: input.presencePenalty ?? null,
              maxIterations: input.maxIterations ?? null,
              timeoutSec: input.timeoutSec ?? null,
              maxContextChars: input.maxContextChars ?? null,
              maxToolResponseChars: input.maxToolResponseChars ?? null,
              maxToolPartsChars: input.maxToolPartsChars ?? null,
            })
            .execute();

          await grantResourceAccess(trx, AgentResource, agentId, [
            { id: ctx.user.id, type: "user", role: "editor" },
            { id: ctx.user.id, type: "user", role: "user" },
          ]);

          const createdAgent = await trx
            .selectFrom("aiAgents")
            .select([
              "id",
              "name",
              "description",
              "instructions",
              "greetingMessage",
              "priority",
              "type",
              "llmProviderId",
              "model",
              "summaryModel",
              "reasoningEffort",
              "codeInterpreter",
              "showToolCalls",
              "toolProviders",
              "streaming",
              "temperature",
              "maxTokens",
              "topP",
              "frequencyPenalty",
              "presencePenalty",
              "maxIterations",
              "timeoutSec",
              "maxContextChars",
              "maxToolResponseChars",
              "maxToolPartsChars",
            ])
            .where("id", "=", agentId)
            .executeTakeFirstOrThrow();

          ctx.logger.info({ agentId }, "Agent created");
          return createdAgent;
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to use this LLM provider",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ name: input.name }, "Agent name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "An agent with this name already exists",
            });
          }
          throw error;
        }
      });

      let llmProviderName: string | null = null;
      if (agent.llmProviderId) {
        // Agent access was verified above, resolve the linked provider in system context
        // eslint-disable-next-line no-restricted-syntax
        const db = await useDb();
        const llmProvider = await db
          .selectFrom("aiLlmProviders")
          .select(["name"])
          .where("id", "=", agent.llmProviderId)
          .executeTakeFirst();
        llmProviderName = llmProvider?.name ?? null;
      }

      return { ...agent, llmProviderName };
    }),

  update: authorizedProcedure([AiPermissions.AgentUpdateAll, AiPermissions.AgentUpdateOwn])
    .input(
      z
        .object({
          id: z.uuid(),
          name: z.string().trim().min(1).max(100).optional(),
          description: z.string().max(500).trim().optional(),
          instructions: z.string().max(100000).trim().optional(),
          greetingMessage: z.string().max(10000).trim().optional(),
          priority: z.number().int().min(-1000).max(1000).optional(),
          llmProviderId: z.uuid().nullish(),
          model: z.string().trim().min(1).max(100).optional(),
          summaryModel: z.string().max(100).trim().optional(),
          reasoningEffort: z.string().max(20).trim().optional(),
          codeInterpreter: z.boolean().optional(),
          showToolCalls: z.boolean().optional(),
          toolProviders: z.array(z.string().min(1).max(100)).max(100).optional(),
          streaming: z.boolean().optional(),
        })
        .extend(AgentExecutorParametersSchema.shape),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;
      const toolProviders = updateData.toolProviders && checkSwitchableToolProviders(updateData.toolProviders);

      const agent = await withUserTransaction(ctx.user, async (trx) => {
        try {
          const updatedAgent = await trx
            .updateTable("aiAgents")
            .set({ ...updateData, toolProviders, updatedAt: new Date() })
            .where("id", "=", id)
            .returning([
              "id",
              "name",
              "description",
              "instructions",
              "greetingMessage",
              "priority",
              "type",
              "llmProviderId",
              "model",
              "summaryModel",
              "reasoningEffort",
              "codeInterpreter",
              "showToolCalls",
              "toolProviders",
              "streaming",
              "temperature",
              "maxTokens",
              "topP",
              "frequencyPenalty",
              "presencePenalty",
              "maxIterations",
              "timeoutSec",
              "maxContextChars",
              "maxToolResponseChars",
              "maxToolPartsChars",
            ])
            .executeTakeFirst();

          if (!updatedAgent) {
            ctx.logger.warn({ agentId: id }, "Agent not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Agent not found or you don't have permission to update it",
            });
          }

          ctx.logger.info({ agentId: id }, "Agent updated");
          return updatedAgent;
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to update this agent or use the selected LLM provider",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ agentId: id, name: input.name }, "Agent name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "An agent with this name already exists",
            });
          }
          throw error;
        }
      });

      let llmProviderName: string | null = null;
      if (agent.llmProviderId) {
        // Agent access was verified above, resolve the linked provider in system context
        // eslint-disable-next-line no-restricted-syntax
        const db = await useDb();
        const llmProvider = await db
          .selectFrom("aiLlmProviders")
          .select(["name"])
          .where("id", "=", agent.llmProviderId)
          .executeTakeFirst();
        llmProviderName = llmProvider?.name ?? null;
      }

      return { ...agent, llmProviderName };
    }),

  delete: authorizedProcedure([AiPermissions.AgentDeleteAll, AiPermissions.AgentDeleteOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("aiAgents")
            .where("id", "=", input.id)
            .returning(["id"])
            .executeTakeFirst();

          if (!deleted) {
            ctx.logger.warn({ agentId: input.id }, "Agent not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Agent not found or you don't have permission to delete it",
            });
          }

          ctx.logger.info({ agentId: input.id }, "Agent deleted");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to delete this agent",
            });
          }
          throw error;
        }
      });
    }),

  ...sharedResourceAccessProcedures({
    resource: AgentResource,
    idKey: "agentId",
    label: "agent",
    readPermissions: [AiPermissions.AgentReadAll, AiPermissions.AgentReadOwn],
    updatePermissions: [AiPermissions.AgentUpdateAll, AiPermissions.AgentUpdateOwn],
  }),

  listInvocable: authorizedProcedure([AiPermissions.AgentUseAll, AiPermissions.AgentUseOwn])
    .input(
      z.object({
        search: z.string().max(255).optional(),
        limit: z.number().min(1).max(100).default(25),
        id: z.uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx
          .selectFrom("aiAgents")
          .select(["aiAgents.id", "aiAgents.name", "aiAgents.description", "aiAgents.type", "aiAgents.priority"])
          .where("aiAgents.llmProviderId", "is not", null)
          .where((eb) => {
            return eb.exists(
              eb
                .selectFrom("aiAgentAccess")
                .select("aiAgentAccess.id")
                .whereRef("aiAgentAccess.agentId", "=", "aiAgents.id")
                .where("aiAgentAccess.role", "=", "user"),
            );
          });

        if (!canAny(ctx.user, [AiPermissions.AgentUseAll])) {
          query = query.where((eb) => {
            return eb.exists(
              eb
                .selectFrom("aiAgentAccess")
                .select("aiAgentAccess.id")
                .whereRef("aiAgentAccess.agentId", "=", "aiAgents.id")
                .where((eb2) => {
                  return eb2.or([
                    eb2("aiAgentAccess.userId", "=", ctx.user.id),
                    ...(ctx.user.groups.length > 0 ? [eb2("aiAgentAccess.groupId", "in", ctx.user.groups)] : []),
                  ]);
                }),
            );
          });
        }

        if (input.id) {
          query = query.where("aiAgents.id", "=", input.id);
        } else if (input.search) {
          query = query.where("aiAgents.name", "ilike", `%${input.search}%`);
        }

        const agents = await query
          .orderBy("aiAgents.priority", "desc")
          .orderBy("aiAgents.name", "asc")
          .limit(input.limit)
          .execute();

        ctx.logger.debug("Invocable agent list retrieved");
        return agents;
      });
    }),

  listSpecialists: authorizedProcedure([AiPermissions.AgentReadAll, AiPermissions.AgentReadOwn])
    .input(z.object({ triageAgentId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const agent = await withUserTransaction(ctx.user, async (trx) => {
        return trx.selectFrom("aiAgents").select(["id"]).where("id", "=", input.triageAgentId).executeTakeFirst();
      });

      if (!agent) {
        ctx.logger.warn({ triageAgentId: input.triageAgentId }, "Agent not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }

      // Agent access was verified above, load linked specialists in system context
      // eslint-disable-next-line no-restricted-syntax
      const db = await useDb();
      const specialists = await db
        .selectFrom("aiTriageSpecialists")
        .innerJoin("aiAgents", "aiAgents.id", "aiTriageSpecialists.specialistAgentId")
        .select(["aiAgents.id", "aiAgents.name"])
        .where("aiTriageSpecialists.triageAgentId", "=", input.triageAgentId)
        .orderBy("aiAgents.name", "asc")
        .execute();

      ctx.logger.debug({ triageAgentId: input.triageAgentId }, "Triage specialists list retrieved");
      return specialists;
    }),

  syncSpecialists: authorizedProcedure([AiPermissions.AgentUpdateAll, AiPermissions.AgentUpdateOwn])
    .input(
      z.object({
        triageAgentId: z.uuid(),
        specialistIds: z.array(z.uuid()).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const agent = await trx
            .selectFrom("aiAgents")
            .select(["type"])
            .where("id", "=", input.triageAgentId)
            .executeTakeFirst();

          if (!agent) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Agent not found or you don't have permission to update it",
            });
          }

          if (agent.type !== "triage") {
            if (input.specialistIds.length > 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Only triage agents can have specialists assigned",
              });
            }
            return;
          }

          const current = await trx
            .selectFrom("aiTriageSpecialists")
            .select(["specialistAgentId"])
            .where("triageAgentId", "=", input.triageAgentId)
            .execute();

          const newIds = [...new Set(input.specialistIds)].filter(
            (id) => !current.some((c) => c.specialistAgentId === id),
          );
          if (newIds.length > 0) {
            const validCount = await trx
              .selectFrom("aiAgents")
              .select((eb) => eb.fn.countAll().as("count"))
              .where("id", "in", newIds)
              .where("type", "=", "specialist")
              .executeTakeFirstOrThrow();

            if (Number(validCount.count) !== newIds.length) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Some agents are not specialist type or do not exist",
              });
            }
          }

          const { added, removed } = await syncLinks(
            trx,
            "ai_triage_specialists",
            { triage_agent_id: input.triageAgentId },
            "specialist_agent_id",
            input.specialistIds,
          );

          ctx.logger.info({ triageAgentId: input.triageAgentId, added, removed }, "Triage specialists synchronized");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to edit this triage agent or access these specialists",
            });
          }
          if (isForeignKeyViolation(error)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "One or more specialist agents do not exist",
            });
          }
          if (isUniqueViolation(error)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Duplicate specialist assignment",
            });
          }
          throw error;
        }
      });
    }),

  listMcpServers: authorizedProcedure([AiPermissions.AgentReadAll, AiPermissions.AgentReadOwn])
    .input(z.object({ agentId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const agent = await withUserTransaction(ctx.user, async (trx) => {
        return trx.selectFrom("aiAgents").select(["id"]).where("id", "=", input.agentId).executeTakeFirst();
      });

      if (!agent) {
        ctx.logger.warn({ agentId: input.agentId }, "Agent not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }

      // Agent access was verified above, load linked MCP servers in system context
      // eslint-disable-next-line no-restricted-syntax
      const db = await useDb();
      const mcpServers = await db
        .selectFrom("aiAgentMcpServers")
        .innerJoin("aiMcpServers", "aiMcpServers.id", "aiAgentMcpServers.mcpServerId")
        .select(["aiMcpServers.id", "aiMcpServers.name"])
        .where("aiAgentMcpServers.agentId", "=", input.agentId)
        .orderBy("aiMcpServers.name", "asc")
        .execute();

      ctx.logger.debug({ agentId: input.agentId }, "Agent MCP servers list retrieved");
      return mcpServers;
    }),

  syncMcpServers: authorizedProcedure([AiPermissions.AgentUpdateAll, AiPermissions.AgentUpdateOwn])
    .input(
      z.object({
        agentId: z.uuid(),
        mcpServerIds: z.array(z.uuid()).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const { added, removed } = await syncLinks(
            trx,
            "ai_agent_mcp_servers",
            { agent_id: input.agentId },
            "mcp_server_id",
            input.mcpServerIds,
          );

          ctx.logger.info({ agentId: input.agentId, added, removed }, "Agent MCP servers synchronized");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to edit this agent or access these MCP servers",
            });
          }
          if (isForeignKeyViolation(error)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "One or more MCP servers do not exist",
            });
          }
          if (isUniqueViolation(error)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Duplicate MCP server assignment",
            });
          }
          throw error;
        }
      });
    }),

  listSkills: authorizedProcedure([AiPermissions.AgentReadAll, AiPermissions.AgentReadOwn])
    .input(z.object({ agentId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const agent = await withUserTransaction(ctx.user, async (trx) => {
        return trx.selectFrom("aiAgents").select(["id"]).where("id", "=", input.agentId).executeTakeFirst();
      });

      if (!agent) {
        ctx.logger.warn({ agentId: input.agentId }, "Agent not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }

      // Agent access was verified above, load linked skills in system context
      // eslint-disable-next-line no-restricted-syntax
      const db = await useDb();
      const skills = await db
        .selectFrom("aiAgentSkills")
        .innerJoin("aiSkills", "aiSkills.id", "aiAgentSkills.skillId")
        .select(["aiSkills.id", "aiSkills.name"])
        .where("aiAgentSkills.agentId", "=", input.agentId)
        .orderBy("aiSkills.name", "asc")
        .execute();

      ctx.logger.debug({ agentId: input.agentId }, "Agent skills list retrieved");
      return skills;
    }),

  syncSkills: authorizedProcedure([AiPermissions.AgentUpdateAll, AiPermissions.AgentUpdateOwn])
    .input(
      z.object({
        agentId: z.uuid(),
        skillIds: z.array(z.uuid()).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const { added, removed } = await syncLinks(
            trx,
            "ai_agent_skills",
            { agent_id: input.agentId },
            "skill_id",
            input.skillIds,
          );

          ctx.logger.info({ agentId: input.agentId, added, removed }, "Agent skills synchronized");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to edit this agent or access these skills",
            });
          }
          if (isForeignKeyViolation(error)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "One or more skills do not exist",
            });
          }
          if (isUniqueViolation(error)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Duplicate skill assignment",
            });
          }
          throw error;
        }
      });
    }),

  listToolProviders: authorizedProcedure([
    AiPermissions.AgentReadAll,
    AiPermissions.AgentReadOwn,
    AiPermissions.AgentCreate,
  ]).query(() => {
    return getToolProviders().map((provider) => ({
      name: provider.name,
      label: provider.label,
      assignable: hasToolResources(provider),
    }));
  }),

  searchToolResources: authorizedProcedure([
    AiPermissions.AgentCreate,
    AiPermissions.AgentUpdateAll,
    AiPermissions.AgentUpdateOwn,
  ])
    .input(
      z.object({
        provider: z.string().min(1).max(100),
        search: z.string().max(255).optional(),
        limit: z.number().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const provider = findResourceToolProvider(input.provider);

      return withUserTransaction(ctx.user, async (trx) => {
        const resources = await listResources(trx, provider.resource, { search: input.search, limit: input.limit });
        ctx.logger.debug({ provider: provider.name }, "Tool resource list retrieved");
        return resources;
      });
    }),

  listToolResources: authorizedProcedure([AiPermissions.AgentReadAll, AiPermissions.AgentReadOwn])
    .input(z.object({ agentId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const agent = await withUserTransaction(ctx.user, async (trx) => {
        return trx.selectFrom("aiAgents").select(["id"]).where("id", "=", input.agentId).executeTakeFirst();
      });

      if (!agent) {
        ctx.logger.warn({ agentId: input.agentId }, "Agent not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }

      // Agent access was verified above, load assigned resources in system context
      // eslint-disable-next-line no-restricted-syntax
      const db = await useDb();
      const assigned = await db
        .selectFrom("aiAgentToolResources")
        .select(["resourceType", "resourceId"])
        .where("agentId", "=", input.agentId)
        .execute();

      const resources: { provider: string; id: string; name: string }[] = [];
      for (const provider of getToolProviders().filter(hasToolResources)) {
        const ids = assigned
          .filter((resource) => resource.resourceType === provider.resource.type)
          .map((resource) => resource.resourceId);
        for (const resource of await listResources(db, provider.resource, { ids })) {
          resources.push({ provider: provider.name, ...resource });
        }
      }

      ctx.logger.debug({ agentId: input.agentId }, "Agent tool resources list retrieved");
      return resources;
    }),

  syncToolResources: authorizedProcedure([AiPermissions.AgentUpdateAll, AiPermissions.AgentUpdateOwn])
    .input(
      z.object({
        agentId: z.uuid(),
        provider: z.string().min(1).max(100),
        resourceIds: z.array(z.uuid()).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const provider = findResourceToolProvider(input.provider);

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const { added, removed } = await syncAgentToolResources(trx, input.agentId, provider, input.resourceIds);
          ctx.logger.info(
            { agentId: input.agentId, provider: provider.name, added, removed },
            "Agent tool resources synchronized",
          );
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to edit this agent or use these resources",
            });
          }
          if (isUniqueViolation(error)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Duplicate resource assignment",
            });
          }
          throw error;
        }
      });
    }),

  testModel: authorizedProcedure([AiPermissions.LlmProviderUseAll, AiPermissions.LlmProviderUseOwn])
    .input(
      z
        .object({
          llmProviderId: z.uuid(),
          model: z.string().trim().min(1).max(100),
          reasoningEffort: z.string().max(20).trim().default(""),
          streaming: z.boolean().default(true),
        })
        .extend(
          AgentExecutorParametersSchema.pick({
            temperature: true,
            maxTokens: true,
            topP: true,
            frequencyPenalty: true,
            presencePenalty: true,
          }).shape,
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const llmProvider = await withUserTransaction(ctx.user, async (trx) => {
        if (!canAny(ctx.user, [AiPermissions.LlmProviderUseAll])) {
          const hasAccess = await trx
            .selectFrom("aiLlmProviderAccess")
            .select(["id"])
            .where("llmProviderId", "=", input.llmProviderId)
            .where((eb) => {
              return eb.or([
                eb("userId", "=", ctx.user.id),
                ...(ctx.user.groups.length > 0 ? [eb("groupId", "in", ctx.user.groups)] : []),
              ]);
            })
            .executeTakeFirst();

          if (!hasAccess) {
            return undefined;
          }
        }

        return trx
          .selectFrom("aiLlmProviders")
          .select(["apiUrl", "apiType", "apiKey", "headers"])
          .where("id", "=", input.llmProviderId)
          .executeTakeFirst();
      });

      if (!llmProvider) {
        ctx.logger.warn({ llmProviderId: input.llmProviderId }, "LLM provider not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "LLM provider not found or you don't have permission to use it",
        });
      }

      const llmClient = new LlmClient({
        apiUrl: llmProvider.apiUrl,
        apiType: llmProvider.apiType,
        apiKey: llmProvider.apiKey,
        headers: llmProvider.headers,
        model: input.model,
        streaming: input.streaming,
      });

      return llmClient.testModel({
        reasoning: input.reasoningEffort ? { effort: input.reasoningEffort } : undefined,
        temperature: input.temperature ?? undefined,
        max_output_tokens: input.maxTokens ?? undefined,
        top_p: input.topP ?? undefined,
        frequency_penalty: input.frequencyPenalty ?? undefined,
        presence_penalty: input.presencePenalty ?? undefined,
      });
    }),
});
