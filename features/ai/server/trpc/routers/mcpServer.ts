import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { HttpRedactedHeader } from "#layers/core/shared/http";
import { MCPClient } from "#layers/ai/server/lib/mcp/client";
import { McpServerResource } from "#layers/ai/server/lib/resources";
import { MCPServerParametersSchema } from "#layers/ai/shared/mcp";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { grantResourceAccess } from "#layers/core/server/lib/authz/resources";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { paginate } from "#layers/core/server/lib/database/pagination";
import { sharedResourceAccessProcedures } from "#layers/core/server/trpc/access";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";
import { HttpHeadersSchema, HttpRedactedValue } from "#layers/core/shared/http";

interface WithRedactedValues {
  headers: HttpRedactedHeader[];
  [key: string]: unknown;
}

export const mcpServerRouter = createTRPCRouter({
  read: authorizedProcedure([AiPermissions.McpServerReadAll, AiPermissions.McpServerReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const mcpServer = await trx
          .selectFrom("aiMcpServers")
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

  search: authorizedProcedure([AiPermissions.McpServerListAll, AiPermissions.McpServerListOwn])
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
        let query = trx.selectFrom("aiMcpServers").select(["id", "name", "description", "url"]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb(`aiMcpServers.${searchBy}`, "ilike", `%${v}%`))));
        }

        const { rows: mcpServers, nextCursor } = await paginate(query, {
          table: "aiMcpServers",
          orderBy,
          order,
          limit,
          cursor,
        });

        ctx.logger.debug("MCP server list retrieved");
        return { mcpServers, nextCursor };
      });
    }),

  create: authorizedProcedure([AiPermissions.McpServerCreate])
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
            .insertInto("aiMcpServers")
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

          await grantResourceAccess(trx, McpServerResource, mcpServerId, [
            { id: ctx.user.id, type: "user", role: "editor" },
            { id: ctx.user.id, type: "user", role: "user" },
          ]);

          const mcpServer = await trx
            .selectFrom("aiMcpServers")
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

  update: authorizedProcedure([AiPermissions.McpServerUpdateAll, AiPermissions.McpServerUpdateOwn])
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
              .selectFrom("aiMcpServers")
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
            .updateTable("aiMcpServers")
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

  delete: authorizedProcedure([AiPermissions.McpServerDeleteAll, AiPermissions.McpServerDeleteOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("aiMcpServers")
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

  ...sharedResourceAccessProcedures({
    resource: McpServerResource,
    idKey: "mcpServerId",
    label: "MCP server",
    readPermissions: [AiPermissions.McpServerReadAll, AiPermissions.McpServerReadOwn],
    updatePermissions: [AiPermissions.McpServerUpdateAll, AiPermissions.McpServerUpdateOwn],
  }),

  testConnection: authorizedProcedure([
    AiPermissions.McpServerCreate,
    AiPermissions.McpServerUpdateAll,
    AiPermissions.McpServerUpdateOwn,
  ])
    .input(
      z.object({
        id: z.uuid().optional(),
        url: z.url(),
        headers: HttpHeadersSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id } = input;

      let { headers = [] } = input;
      if (id) {
        // The lock limits the secrets to those who can update it
        const stored = await withUserTransaction(ctx.user, (trx) => {
          return trx.selectFrom("aiMcpServers").select(["headers"]).where("id", "=", id).forUpdate().executeTakeFirst();
        });
        headers = headers.map((h) => {
          return h.value === HttpRedactedValue
            ? { ...h, value: stored?.headers.find((e) => e.name === h.name)?.value ?? "" }
            : h;
        });
      }

      const mcpClient = new MCPClient({ name: input.url, url: input.url, headers, stateful: false, timeoutMs: 10_000 });

      return mcpClient.testConnection();
    }),
});
