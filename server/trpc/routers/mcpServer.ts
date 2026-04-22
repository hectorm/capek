import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { HttpRedactedHeader } from "~~/shared/http";
import type { Principal } from "~~/shared/rbac";
import { withUserTransaction } from "~~/server/lib/database";
import { isRLSViolation, isUniqueViolation } from "~~/server/lib/database/errors";
import { authorizedProcedure, createTRPCRouter } from "~~/server/trpc/init";
import { HttpHeadersSchema, HttpRedactedValue } from "~~/shared/http";
import { MCPServerParametersSchema } from "~~/shared/mcp";
import { Permissions } from "~~/shared/rbac";

interface WithRedactedValues {
  headers: HttpRedactedHeader[];
  [key: string]: unknown;
}

export const mcpServerRouter = createTRPCRouter({
  read: authorizedProcedure([Permissions.McpServerReadAll, Permissions.McpServerReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const mcpServer = await trx
          .selectFrom("mcpServers")
          .select(["id", "name", "description", "url", "headers", "stateful", "toolCallTimeoutSec"])
          .where("id", "=", input.id)
          .executeTakeFirst();

        if (!mcpServer) {
          ctx.logger.warn({ mcpServerId: input.id }, "MCP server not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "MCP server not found",
          });
        }

        ctx.logger.debug({ mcpServerId: input.id }, "MCP server retrieved");
        return {
          ...mcpServer,
          headers: mcpServer.headers.map((h) => ({ name: h.name, value: HttpRedactedValue })),
        } satisfies WithRedactedValues;
      });
    }),

  search: authorizedProcedure([Permissions.McpServerListAll, Permissions.McpServerListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["name", "description", "url"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description", "url"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.uuid().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx.selectFrom("mcpServers").select(["id", "name", "description", "url"]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb(`mcpServers.${searchBy}`, "ilike", `%${v}%`))));
        }

        // Apply cursor-based pagination
        if (cursor) {
          const cursorMcpServer = await trx
            .selectFrom("mcpServers")
            .select(["id", orderBy])
            .where("id", "=", cursor)
            .executeTakeFirst();

          if (cursorMcpServer) {
            if (order === "asc") {
              query = query.where((eb) =>
                eb.or([
                  eb(`mcpServers.${orderBy}`, ">", cursorMcpServer[orderBy]),
                  eb.and([
                    eb(`mcpServers.${orderBy}`, "=", cursorMcpServer[orderBy]),
                    eb("mcpServers.id", ">", cursorMcpServer.id),
                  ]),
                ]),
              );
            } else {
              query = query.where((eb) =>
                eb.or([
                  eb(`mcpServers.${orderBy}`, "<", cursorMcpServer[orderBy]),
                  eb.and([
                    eb(`mcpServers.${orderBy}`, "=", cursorMcpServer[orderBy]),
                    eb("mcpServers.id", "<", cursorMcpServer.id),
                  ]),
                ]),
              );
            }
          }
        }

        // Apply ordering and limit
        query = query
          .orderBy(`mcpServers.${orderBy}`, order)
          .orderBy("mcpServers.id", order)
          .limit(limit + 1);

        const mcpServers = await query.execute();

        let nextCursor: string | undefined = undefined;
        if (mcpServers.length > limit) {
          mcpServers.pop();
          nextCursor = mcpServers[mcpServers.length - 1]?.id;
        }

        ctx.logger.debug("MCP server list retrieved");
        return { mcpServers, nextCursor };
      });
    }),

  create: authorizedProcedure([Permissions.McpServerCreate])
    .input(
      z
        .object({
          name: z.string().min(1).max(100).trim(),
          description: z.string().max(1000).trim().default(""),
          url: z.url(),
          headers: HttpHeadersSchema.optional(),
          stateful: z.boolean().default(false),
        })
        .extend(MCPServerParametersSchema.shape),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const mcpServerId = crypto.randomUUID();

          await trx
            .insertInto("mcpServers")
            .values({
              id: mcpServerId,
              name: input.name,
              description: input.description,
              url: input.url,
              headers: JSON.stringify(input.headers ?? []),
              stateful: input.stateful,
              toolCallTimeoutSec: input.toolCallTimeoutSec ?? null,
              cachedTools: "[]",
            })
            .execute();

          await trx
            .insertInto("mcpServerAccess")
            .values([
              { mcpServerId, userId: ctx.user.id, groupId: null, role: "editor" },
              { mcpServerId, userId: ctx.user.id, groupId: null, role: "user" },
            ])
            .execute();

          const mcpServer = await trx
            .selectFrom("mcpServers")
            .select(["id", "name", "description", "url", "headers", "stateful", "toolCallTimeoutSec"])
            .where("id", "=", mcpServerId)
            .executeTakeFirstOrThrow();

          ctx.logger.info({ mcpServerId }, "MCP server created");
          return {
            ...mcpServer,
            headers: mcpServer.headers.map((h) => ({ name: h.name, value: HttpRedactedValue })),
          } satisfies WithRedactedValues;
        } catch (error) {
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ name: input.name }, "MCP server name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "An MCP server with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  update: authorizedProcedure([Permissions.McpServerUpdateAll, Permissions.McpServerUpdateOwn])
    .input(
      z
        .object({
          id: z.uuid(),
          name: z.string().min(1).max(100).trim().optional(),
          description: z.string().max(1000).trim().optional(),
          url: z.url().optional(),
          headers: HttpHeadersSchema.optional(),
          stateful: z.boolean().optional(),
        })
        .extend(MCPServerParametersSchema.shape),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          if (updateData.headers !== undefined) {
            const existing = await trx
              .selectFrom("mcpServers")
              .select(["headers"])
              .where("id", "=", id)
              .executeTakeFirst();
            updateData.headers = updateData.headers.map((h) => {
              return h.value === HttpRedactedValue
                ? { ...h, value: existing?.headers.find((e) => e.name === h.name)?.value ?? "" }
                : h;
            });
          }

          const headers = updateData.headers ? JSON.stringify(updateData.headers) : undefined;
          const cachedTools = updateData.url || updateData.headers ? "[]" : undefined;

          const mcpServer = await trx
            .updateTable("mcpServers")
            .set({ ...updateData, headers, cachedTools, updatedAt: new Date() })
            .where("id", "=", id)
            .returning(["id", "name", "description", "url", "headers", "stateful", "toolCallTimeoutSec"])
            .executeTakeFirst();

          if (!mcpServer) {
            ctx.logger.warn({ mcpServerId: id }, "MCP server not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "MCP server not found or you don't have permission to update it",
            });
          }

          ctx.logger.info({ mcpServerId: id }, "MCP server updated");
          return {
            ...mcpServer,
            headers: mcpServer.headers.map((h) => ({ name: h.name, value: HttpRedactedValue })),
          } satisfies WithRedactedValues;
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to update this MCP server",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ mcpServerId: id, name: input.name }, "MCP server name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "An MCP server with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  delete: authorizedProcedure([Permissions.McpServerDeleteAll, Permissions.McpServerDeleteOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("mcpServers")
            .where("id", "=", input.id)
            .returning(["id"])
            .executeTakeFirst();

          if (!deleted) {
            ctx.logger.warn({ mcpServerId: input.id }, "MCP server not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "MCP server not found or you don't have permission to delete it",
            });
          }

          ctx.logger.info({ mcpServerId: input.id }, "MCP server deleted");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to delete this MCP server",
            });
          }
          throw error;
        }
      });
    }),

  listAccess: authorizedProcedure([Permissions.McpServerReadAll, Permissions.McpServerReadOwn])
    .input(z.object({ mcpServerId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const access = await trx
          .selectFrom("mcpServerAccess")
          .leftJoin("users", "users.id", "mcpServerAccess.userId")
          .leftJoin("groups", "groups.id", "mcpServerAccess.groupId")
          .select([
            "mcpServerAccess.mcpServerId",
            "mcpServerAccess.userId",
            "mcpServerAccess.groupId",
            "mcpServerAccess.role",
            "users.username",
            "users.email",
            "groups.name as groupname",
          ])
          .where("mcpServerAccess.mcpServerId", "=", input.mcpServerId)
          .execute();

        const mapped: Principal[] = [];
        for (const a of access) {
          if (a.userId !== null && a.username !== null && a.email !== null) {
            mapped.push({ id: a.userId, type: "user", role: a.role, username: a.username, email: a.email });
          } else if (a.groupId !== null && a.groupname !== null) {
            mapped.push({ id: a.groupId, type: "group", role: a.role, groupname: a.groupname });
          }
        }

        ctx.logger.debug({ mcpServerId: input.mcpServerId }, "MCP server access list retrieved");
        return mapped;
      });
    }),

  syncAccess: authorizedProcedure([Permissions.McpServerUpdateAll, Permissions.McpServerUpdateOwn])
    .input(
      z.object({
        mcpServerId: z.uuid(),
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
            .selectFrom("mcpServerAccess")
            .select(["userId", "groupId", "role"])
            .where("mcpServerId", "=", input.mcpServerId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.access.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("mcpServerAccess").where("mcpServerId", "=", input.mcpServerId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("mcpServerAccess")
              .values(
                input.access.map((a) => ({
                  mcpServerId: input.mcpServerId,
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
                    .deleteFrom("mcpServerAccess")
                    .where("mcpServerId", "=", input.mcpServerId)
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
                    .insertInto("mcpServerAccess")
                    .values(
                      toAdd.map((a) => ({
                        mcpServerId: input.mcpServerId,
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

          ctx.logger.info({ mcpServerId: input.mcpServerId, added, removed }, "MCP server access synchronized");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to manage access for this MCP server",
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
});
