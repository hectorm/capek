import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { AgentResource } from "#layers/ai/server/lib/resources";
import { syncAgentToolResources } from "#layers/ai/server/lib/tools";
import { AgentExecutorParametersSchema } from "#layers/ai/shared/agent";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { grantResourceAccess, listResources } from "#layers/core/server/lib/authz/resources";
import { useDb, withUserTransaction } from "#layers/core/server/lib/database";
import { isForeignKeyViolation, isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
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
            "type",
            "llmProviderId",
            "model",
            "summaryModel",
            "codeInterpreter",
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
        orderBy: z.enum(["name", "description", "type", "model"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.uuid().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order, type } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx
          .selectFrom("aiAgents")
          .select(["aiAgents.id", "aiAgents.name", "aiAgents.description", "aiAgents.type", "aiAgents.model"]);

        if (type) {
          query = query.where("aiAgents.type", "=", type);
        }

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb(`aiAgents.${searchBy}`, "ilike", `%${v}%`))));
        }

        // Apply cursor-based pagination
        if (cursor) {
          const cursorAgent = await trx
            .selectFrom("aiAgents")
            .select(["id", orderBy])
            .where("id", "=", cursor)
            .executeTakeFirst();

          if (cursorAgent) {
            if (order === "asc") {
              query = query.where((eb) =>
                eb.or([
                  eb(`aiAgents.${orderBy}`, ">", cursorAgent[orderBy]),
                  eb.and([
                    eb(`aiAgents.${orderBy}`, "=", cursorAgent[orderBy]),
                    eb("aiAgents.id", ">", cursorAgent.id),
                  ]),
                ]),
              );
            } else {
              query = query.where((eb) =>
                eb.or([
                  eb(`aiAgents.${orderBy}`, "<", cursorAgent[orderBy]),
                  eb.and([
                    eb(`aiAgents.${orderBy}`, "=", cursorAgent[orderBy]),
                    eb("aiAgents.id", "<", cursorAgent.id),
                  ]),
                ]),
              );
            }
          }
        }

        // Apply ordering and limit
        query = query
          .orderBy(`aiAgents.${orderBy}`, order)
          .orderBy("aiAgents.id", order)
          .limit(limit + 1);

        const agents = await query.execute();

        let nextCursor: string | undefined = undefined;
        if (agents.length > limit) {
          agents.pop();
          nextCursor = agents[agents.length - 1]?.id;
        }

        ctx.logger.debug("Agent list retrieved");
        return { agents, nextCursor };
      });
    }),

  create: authorizedProcedure([AiPermissions.AgentCreate])
    .input(
      z
        .object({
          name: z.string().min(1).max(100).trim(),
          description: z.string().max(1000).trim().default(""),
          instructions: z.string().max(100000).trim().default(""),
          greetingMessage: z.string().max(10000).trim().default(""),
          type: z.enum(["triage", "specialist"]),
          llmProviderId: z.uuid().nullish(),
          model: z.string().min(1).max(100).trim(),
          summaryModel: z.string().max(100).trim().default(""),
          codeInterpreter: z.boolean().default(false),
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
              type: input.type,
              llmProviderId: input.llmProviderId ?? null,
              model: input.model,
              summaryModel: input.summaryModel,
              codeInterpreter: input.type === "specialist" ? input.codeInterpreter : false,
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
              "type",
              "llmProviderId",
              "model",
              "summaryModel",
              "codeInterpreter",
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
          name: z.string().min(1).max(100).trim().optional(),
          description: z.string().max(1000).trim().optional(),
          instructions: z.string().max(100000).trim().optional(),
          greetingMessage: z.string().max(10000).trim().optional(),
          llmProviderId: z.uuid().nullish(),
          model: z.string().min(1).max(100).trim().optional(),
          summaryModel: z.string().max(100).trim().optional(),
          codeInterpreter: z.boolean().optional(),
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
              "type",
              "llmProviderId",
              "model",
              "summaryModel",
              "codeInterpreter",
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

  listInvocable: authorizedProcedure([AiPermissions.AgentUseAll, AiPermissions.AgentUseOwn]).query(async ({ ctx }) => {
    return withUserTransaction(ctx.user, async (trx) => {
      const agents = await trx
        .selectFrom("aiAgents")
        .innerJoin("aiAgentAccess", "aiAgentAccess.agentId", "aiAgents.id")
        .select(["aiAgents.id", "aiAgents.name", "aiAgents.description", "aiAgents.type"])
        .where("aiAgentAccess.role", "=", "user")
        .where("aiAgents.llmProviderId", "is not", null)
        .distinct()
        .orderBy("aiAgents.name", "asc")
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

          if (input.specialistIds.length > 0) {
            const validCount = await trx
              .selectFrom("aiAgents")
              .select((eb) => eb.fn.countAll().as("count"))
              .where("id", "in", input.specialistIds)
              .where("type", "=", "specialist")
              .executeTakeFirstOrThrow();

            if (Number(validCount.count) !== input.specialistIds.length) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Some agents are not specialist type or do not exist",
              });
            }
          }

          const current = await trx
            .selectFrom("aiTriageSpecialists")
            .select(["specialistAgentId"])
            .where("triageAgentId", "=", input.triageAgentId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.specialistIds.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("aiTriageSpecialists").where("triageAgentId", "=", input.triageAgentId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("aiTriageSpecialists")
              .values(
                input.specialistIds.map((specialistAgentId) => ({
                  triageAgentId: input.triageAgentId,
                  specialistAgentId,
                })),
              )
              .execute();
            added = input.specialistIds.length;
          } else {
            const currentSet = new Set(current.map((c) => c.specialistAgentId));
            const targetSet = new Set(input.specialistIds);

            const toAdd = input.specialistIds.filter((id) => !currentSet.has(id));
            const toRemove = current.filter((c) => !targetSet.has(c.specialistAgentId));

            if (toAdd.length > 0 || toRemove.length > 0) {
              const ops = [];
              if (toRemove.length > 0) {
                ops.push(
                  trx
                    .deleteFrom("aiTriageSpecialists")
                    .where("triageAgentId", "=", input.triageAgentId)
                    .where(
                      "specialistAgentId",
                      "in",
                      toRemove.map((r) => r.specialistAgentId),
                    )
                    .execute(),
                );
              }
              if (toAdd.length > 0) {
                ops.push(
                  trx
                    .insertInto("aiTriageSpecialists")
                    .values(
                      toAdd.map((specialistAgentId) => ({
                        triageAgentId: input.triageAgentId,
                        specialistAgentId,
                      })),
                    )
                    .execute(),
                );
              }
              await Promise.all(ops);
              added = toAdd.length;
              removed = toRemove.length;
            }
          }

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
          const current = await trx
            .selectFrom("aiAgentMcpServers")
            .select(["mcpServerId"])
            .where("agentId", "=", input.agentId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.mcpServerIds.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("aiAgentMcpServers").where("agentId", "=", input.agentId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("aiAgentMcpServers")
              .values(
                input.mcpServerIds.map((mcpServerId) => ({
                  agentId: input.agentId,
                  mcpServerId,
                })),
              )
              .execute();
            added = input.mcpServerIds.length;
          } else {
            const currentSet = new Set(current.map((c) => c.mcpServerId));
            const targetSet = new Set(input.mcpServerIds);

            const toAdd = input.mcpServerIds.filter((id) => !currentSet.has(id));
            const toRemove = current.filter((c) => !targetSet.has(c.mcpServerId));

            if (toAdd.length > 0 || toRemove.length > 0) {
              const ops = [];
              if (toRemove.length > 0) {
                ops.push(
                  trx
                    .deleteFrom("aiAgentMcpServers")
                    .where("agentId", "=", input.agentId)
                    .where(
                      "mcpServerId",
                      "in",
                      toRemove.map((r) => r.mcpServerId),
                    )
                    .execute(),
                );
              }
              if (toAdd.length > 0) {
                ops.push(
                  trx
                    .insertInto("aiAgentMcpServers")
                    .values(
                      toAdd.map((mcpServerId) => ({
                        agentId: input.agentId,
                        mcpServerId,
                      })),
                    )
                    .execute(),
                );
              }
              await Promise.all(ops);
              added = toAdd.length;
              removed = toRemove.length;
            }
          }

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
          const current = await trx
            .selectFrom("aiAgentSkills")
            .select(["skillId"])
            .where("agentId", "=", input.agentId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.skillIds.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("aiAgentSkills").where("agentId", "=", input.agentId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("aiAgentSkills")
              .values(
                input.skillIds.map((skillId) => ({
                  agentId: input.agentId,
                  skillId,
                })),
              )
              .execute();
            added = input.skillIds.length;
          } else {
            const currentSet = new Set(current.map((c) => c.skillId));
            const targetSet = new Set(input.skillIds);

            const toAdd = input.skillIds.filter((id) => !currentSet.has(id));
            const toRemove = current.filter((c) => !targetSet.has(c.skillId));

            if (toAdd.length > 0 || toRemove.length > 0) {
              const ops = [];
              if (toRemove.length > 0) {
                ops.push(
                  trx
                    .deleteFrom("aiAgentSkills")
                    .where("agentId", "=", input.agentId)
                    .where(
                      "skillId",
                      "in",
                      toRemove.map((r) => r.skillId),
                    )
                    .execute(),
                );
              }
              if (toAdd.length > 0) {
                ops.push(
                  trx
                    .insertInto("aiAgentSkills")
                    .values(
                      toAdd.map((skillId) => ({
                        agentId: input.agentId,
                        skillId,
                      })),
                    )
                    .execute(),
                );
              }
              await Promise.all(ops);
              added = toAdd.length;
              removed = toRemove.length;
            }
          }

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
});
