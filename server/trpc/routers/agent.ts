import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { Principal } from "~~/shared/rbac";
import { withUserTransaction } from "~~/server/lib/database";
import { isForeignKeyViolation, isRLSViolation, isUniqueViolation } from "~~/server/lib/database/errors";
import { authorizedProcedure, createTRPCRouter } from "~~/server/trpc/init";
import { AgentExecutorParametersSchema } from "~~/shared/agent";
import { Permissions } from "~~/shared/rbac";

export const agentRouter = createTRPCRouter({
  read: authorizedProcedure([Permissions.AgentReadAll, Permissions.AgentReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const agent = await trx
          .selectFrom("agents")
          .leftJoin("llmProviders", "llmProviders.id", "agents.llmProviderId")
          .select([
            "agents.id",
            "agents.name",
            "agents.description",
            "agents.instructions",
            "agents.greetingMessage",
            "agents.type",
            "agents.llmProviderId",
            "llmProviders.name as llmProviderName",
            "agents.model",
            "agents.summaryModel",
            "agents.codeInterpreter",
            "agents.streaming",
            "agents.temperature",
            "agents.maxTokens",
            "agents.topP",
            "agents.frequencyPenalty",
            "agents.presencePenalty",
            "agents.maxIterations",
            "agents.timeoutSec",
            "agents.maxContextChars",
            "agents.maxToolResponseChars",
          ])
          .where("agents.id", "=", input.id)
          .executeTakeFirst();

        if (!agent) {
          ctx.logger.warn({ agentId: input.id }, "Agent not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });
        }

        ctx.logger.debug({ agentId: input.id }, "Agent retrieved");
        return agent;
      });
    }),

  search: authorizedProcedure([Permissions.AgentListAll, Permissions.AgentListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["name", "description", "type", "llmProviderName", "model"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description", "type", "model"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.uuid().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx
          .selectFrom("agents")
          .leftJoin("llmProviders", "llmProviders.id", "agents.llmProviderId")
          .select([
            "agents.id",
            "agents.name",
            "agents.description",
            "agents.type",
            "llmProviders.name as llmProviderName",
            "agents.model",
          ]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];

          if (searchBy === "llmProviderName") {
            query = query.where((eb) => eb.or(searchList.map((v) => eb("llmProviders.name", "ilike", `%${v}%`))));
          } else {
            query = query.where((eb) => eb.or(searchList.map((v) => eb(`agents.${searchBy}`, "ilike", `%${v}%`))));
          }
        }

        // Apply cursor-based pagination
        if (cursor) {
          const cursorAgent = await trx
            .selectFrom("agents")
            .select(["id", orderBy])
            .where("id", "=", cursor)
            .executeTakeFirst();

          if (cursorAgent) {
            if (order === "asc") {
              query = query.where((eb) =>
                eb.or([
                  eb(`agents.${orderBy}`, ">", cursorAgent[orderBy]),
                  eb.and([eb(`agents.${orderBy}`, "=", cursorAgent[orderBy]), eb("agents.id", ">", cursorAgent.id)]),
                ]),
              );
            } else {
              query = query.where((eb) =>
                eb.or([
                  eb(`agents.${orderBy}`, "<", cursorAgent[orderBy]),
                  eb.and([eb(`agents.${orderBy}`, "=", cursorAgent[orderBy]), eb("agents.id", "<", cursorAgent.id)]),
                ]),
              );
            }
          }
        }

        // Apply ordering and limit
        query = query
          .orderBy(`agents.${orderBy}`, order)
          .orderBy("agents.id", order)
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

  create: authorizedProcedure([Permissions.AgentCreate])
    .input(
      z
        .object({
          name: z.string().min(1).max(100).trim(),
          description: z.string().max(500).trim().default(""),
          instructions: z.string().max(100000).trim().default(""),
          greetingMessage: z.string().max(10000).trim().default(""),
          type: z.enum(["triage", "specialist"]),
          llmProviderId: z.uuid().nullish(),
          model: z.string().min(1).max(100).trim(),
          summaryModel: z.string().max(100).trim().default(""),
          codeInterpreter: z.boolean().default(false),
          streaming: z.boolean().default(true),
        })
        .extend(AgentExecutorParametersSchema.shape),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const agentId = crypto.randomUUID();

          await trx
            .insertInto("agents")
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

          await trx
            .insertInto("agentAccess")
            .values([
              { agentId, userId: ctx.user.id, groupId: null, role: "editor" },
              { agentId, userId: ctx.user.id, groupId: null, role: "user" },
            ])
            .execute();

          const agent = await trx
            .selectFrom("agents")
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
          return agent;
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
    }),

  update: authorizedProcedure([Permissions.AgentUpdateAll, Permissions.AgentUpdateOwn])
    .input(
      z
        .object({
          id: z.uuid(),
          name: z.string().min(1).max(100).trim().optional(),
          description: z.string().max(500).trim().optional(),
          instructions: z.string().max(100000).trim().optional(),
          greetingMessage: z.string().max(10000).trim().optional(),
          llmProviderId: z.uuid().nullish(),
          model: z.string().min(1).max(100).trim().optional(),
          summaryModel: z.string().max(100).trim().optional(),
          codeInterpreter: z.boolean().optional(),
          streaming: z.boolean().optional(),
        })
        .extend(AgentExecutorParametersSchema.shape),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const agent = await trx
            .updateTable("agents")
            .set({ ...updateData, updatedAt: new Date() })
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

          if (!agent) {
            ctx.logger.warn({ agentId: id }, "Agent not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Agent not found or you don't have permission to update it",
            });
          }

          ctx.logger.info({ agentId: id }, "Agent updated");
          return agent;
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
    }),

  delete: authorizedProcedure([Permissions.AgentDeleteAll, Permissions.AgentDeleteOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("agents")
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

  listAccess: authorizedProcedure([Permissions.AgentReadAll, Permissions.AgentReadOwn])
    .input(z.object({ agentId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const access = await trx
          .selectFrom("agentAccess")
          .leftJoin("users", "users.id", "agentAccess.userId")
          .leftJoin("groups", "groups.id", "agentAccess.groupId")
          .select([
            "agentAccess.agentId",
            "agentAccess.userId",
            "agentAccess.groupId",
            "agentAccess.role",
            "users.username",
            "users.email",
            "groups.name as groupname",
          ])
          .where("agentAccess.agentId", "=", input.agentId)
          .execute();

        const mapped: Principal[] = [];
        for (const a of access) {
          if (a.userId !== null && a.username !== null && a.email !== null) {
            mapped.push({ id: a.userId, type: "user", role: a.role, username: a.username, email: a.email });
          } else if (a.groupId !== null && a.groupname !== null) {
            mapped.push({ id: a.groupId, type: "group", role: a.role, groupname: a.groupname });
          }
        }

        ctx.logger.debug({ agentId: input.agentId }, "Agent access list retrieved");
        return mapped;
      });
    }),

  syncAccess: authorizedProcedure([Permissions.AgentUpdateAll, Permissions.AgentUpdateOwn])
    .input(
      z.object({
        agentId: z.uuid(),
        access: z
          .array(
            z.object({
              id: z.uuid(),
              type: z.enum(["user", "group"]),
              role: z.enum(["editor", "user"]),
            }),
          )
          .max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const current = await trx
            .selectFrom("agentAccess")
            .select(["userId", "groupId", "role"])
            .where("agentId", "=", input.agentId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.access.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("agentAccess").where("agentId", "=", input.agentId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("agentAccess")
              .values(
                input.access.map((a) => ({
                  agentId: input.agentId,
                  userId: a.type === "user" ? a.id : null,
                  groupId: a.type === "group" ? a.id : null,
                  role: a.role,
                })),
              )
              .execute();
            added = input.access.length;
          } else {
            const currentMapped = current.map((c) => ({
              id: c.userId ?? c.groupId ?? "",
              type: c.userId !== null ? ("user" as const) : ("group" as const),
              role: c.role,
            }));

            const currentSet = new Set(currentMapped.map((c) => `${c.type}:${c.id}:${c.role}`));
            const targetSet = new Set(input.access.map((a) => `${a.type}:${a.id}:${a.role}`));

            const toAdd = input.access.filter((a) => !currentSet.has(`${a.type}:${a.id}:${a.role}`));
            const toRemove = currentMapped.filter((c) => !targetSet.has(`${c.type}:${c.id}:${c.role}`));

            if (toAdd.length > 0 || toRemove.length > 0) {
              const ops = [];
              if (toRemove.length > 0) {
                ops.push(
                  trx
                    .deleteFrom("agentAccess")
                    .where("agentId", "=", input.agentId)
                    .where((eb) =>
                      eb.or(
                        toRemove.map((a) =>
                          a.type === "user"
                            ? eb.and([eb("userId", "=", a.id), eb("role", "=", a.role)])
                            : eb.and([eb("groupId", "=", a.id), eb("role", "=", a.role)]),
                        ),
                      ),
                    )
                    .execute(),
                );
              }
              if (toAdd.length > 0) {
                ops.push(
                  trx
                    .insertInto("agentAccess")
                    .values(
                      toAdd.map((a) => ({
                        agentId: input.agentId,
                        userId: a.type === "user" ? a.id : null,
                        groupId: a.type === "group" ? a.id : null,
                        role: a.role,
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

          ctx.logger.info({ agentId: input.agentId, added, removed }, "Agent access synchronized");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to manage access for this agent",
            });
          }
          if (isUniqueViolation(error)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Duplicate access entry",
            });
          }
          throw error;
        }
      });
    }),

  listInvocable: authorizedProcedure([Permissions.AgentUseAll, Permissions.AgentUseOwn]).query(async ({ ctx }) => {
    return withUserTransaction(ctx.user, async (trx) => {
      const agents = await trx
        .selectFrom("agents")
        .innerJoin("agentAccess", "agentAccess.agentId", "agents.id")
        .leftJoin("llmProviders", "llmProviders.id", "agents.llmProviderId")
        .select([
          "agents.id",
          "agents.name",
          "agents.description",
          "agents.type",
          "agents.llmProviderId",
          "llmProviders.name as llmProviderName",
          "agents.model",
        ])
        .where("agentAccess.role", "=", "user")
        .where("agents.llmProviderId", "is not", null)
        .distinct()
        .orderBy("agents.name", "asc")
        .execute();

      ctx.logger.debug("Invocable agent list retrieved");
      return agents;
    });
  }),

  listSpecialists: authorizedProcedure([Permissions.AgentReadAll, Permissions.AgentReadOwn])
    .input(z.object({ triageAgentId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const specialists = await trx
          .selectFrom("triageSpecialists")
          .innerJoin("agents", "agents.id", "triageSpecialists.specialistAgentId")
          .select(["agents.id", "agents.name", "agents.description", "agents.type", "triageSpecialists.createdAt"])
          .where("triageSpecialists.triageAgentId", "=", input.triageAgentId)
          .orderBy("agents.name", "asc")
          .execute();

        ctx.logger.debug({ triageAgentId: input.triageAgentId }, "Triage specialists list retrieved");
        return specialists;
      });
    }),

  syncSpecialists: authorizedProcedure([Permissions.AgentUpdateAll, Permissions.AgentUpdateOwn])
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
            .selectFrom("agents")
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
              .selectFrom("agents")
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
            .selectFrom("triageSpecialists")
            .select(["specialistAgentId"])
            .where("triageAgentId", "=", input.triageAgentId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.specialistIds.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("triageSpecialists").where("triageAgentId", "=", input.triageAgentId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("triageSpecialists")
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
                    .deleteFrom("triageSpecialists")
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
                    .insertInto("triageSpecialists")
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

  listMcpServers: authorizedProcedure([Permissions.AgentReadAll, Permissions.AgentReadOwn])
    .input(z.object({ agentId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const mcpServers = await trx
          .selectFrom("agentMcpServers")
          .innerJoin("mcpServers", "mcpServers.id", "agentMcpServers.mcpServerId")
          .select([
            "mcpServers.id",
            "mcpServers.name",
            "mcpServers.description",
            "mcpServers.url",
            "agentMcpServers.createdAt",
          ])
          .where("agentMcpServers.agentId", "=", input.agentId)
          .orderBy("mcpServers.name", "asc")
          .execute();

        ctx.logger.debug({ agentId: input.agentId }, "Agent MCP servers list retrieved");
        return mcpServers;
      });
    }),

  syncMcpServers: authorizedProcedure([Permissions.AgentUpdateAll, Permissions.AgentUpdateOwn])
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
            .selectFrom("agentMcpServers")
            .select(["mcpServerId"])
            .where("agentId", "=", input.agentId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.mcpServerIds.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("agentMcpServers").where("agentId", "=", input.agentId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("agentMcpServers")
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
                    .deleteFrom("agentMcpServers")
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
                    .insertInto("agentMcpServers")
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

  listSkills: authorizedProcedure([Permissions.AgentReadAll, Permissions.AgentReadOwn])
    .input(z.object({ agentId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const skills = await trx
          .selectFrom("agentSkills")
          .innerJoin("skills", "skills.id", "agentSkills.skillId")
          .select(["skills.id", "skills.name", "skills.description", "agentSkills.createdAt"])
          .where("agentSkills.agentId", "=", input.agentId)
          .orderBy("skills.name", "asc")
          .execute();

        ctx.logger.debug({ agentId: input.agentId }, "Agent skills list retrieved");
        return skills;
      });
    }),

  syncSkills: authorizedProcedure([Permissions.AgentUpdateAll, Permissions.AgentUpdateOwn])
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
            .selectFrom("agentSkills")
            .select(["skillId"])
            .where("agentId", "=", input.agentId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.skillIds.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("agentSkills").where("agentId", "=", input.agentId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("agentSkills")
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
                    .deleteFrom("agentSkills")
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
                    .insertInto("agentSkills")
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
});
