import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { Endpoint } from "#layers/core/server/lib/http";
import type { HttpRedactedHeader } from "#layers/core/shared/http";
import { MCPClient } from "#layers/ai/server/lib/mcp/client";
import { McpServerResource } from "#layers/ai/server/lib/resources";
import { MCPServerParametersSchema } from "#layers/ai/shared/mcp";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { grantResourceAccess } from "#layers/core/server/lib/authz/resources";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { paginate } from "#layers/core/server/lib/database/pagination";
import { unredactEndpoint } from "#layers/core/server/lib/http";
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
      const { id, url, headers, ...updateData } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const existing = await trx
            .selectFrom("aiMcpServers")
            .select(["url", "headers"])
            .where("id", "=", id)
            .forUpdate()
            .executeTakeFirst();
          const endpoint = unredactEndpoint({ url, headers }, existing);

          // The tools are discovered again when the server may be another one
          const cachedTools = url !== undefined || headers !== undefined ? "[]" : undefined;

          const mcpServer = await trx
            .updateTable("aiMcpServers")
            .set({
              ...updateData,
              url: endpoint.url,
              headers: JSON.stringify(endpoint.headers),
              cachedTools,
              updatedAt: new Date(),
            })
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

      let endpoint: Endpoint = { url: input.url, headers: input.headers ?? [] };
      if (id) {
        // The lock limits the secrets to those who can update it
        const stored = await withUserTransaction(ctx.user, (trx) => {
          return trx
            .selectFrom("aiMcpServers")
            .select(["url", "headers"])
            .where("id", "=", id)
            .forUpdate()
            .executeTakeFirst();
        });
        endpoint = unredactEndpoint(endpoint, stored);
      }

      const mcpClient = new MCPClient({
        name: endpoint.url,
        url: endpoint.url,
        headers: endpoint.headers,
        stateful: false,
        timeoutMs: 10_000,
      });

      return mcpClient.testConnection();
    }),
});
