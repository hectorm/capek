import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { Endpoint } from "#layers/core/server/lib/http";
import type { HttpRedactedHeader } from "#layers/core/shared/http";
import { LlmClient } from "#layers/ai/server/lib/llm/client";
import { LlmProviderResource } from "#layers/ai/server/lib/resources";
import { LlmProviderApiTypeSchema } from "#layers/ai/shared/llmProvider";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { can } from "#layers/core/server/lib/authz/permissions";
import { grantResourceAccess } from "#layers/core/server/lib/authz/resources";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { isForeignKeyViolation, isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { PageCursorSchema, paginate } from "#layers/core/server/lib/database/pagination";
import { unredactEndpoint } from "#layers/core/server/lib/http";
import { sharedResourceAccessProcedures } from "#layers/core/server/trpc/access";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";
import { HttpHeadersSchema, HttpRedactedValue, HttpUrlSchema } from "#layers/core/shared/http";

interface WithRedactedValues {
  apiKey: HttpRedactedHeader["value"];
  headers: HttpRedactedHeader[];
  [key: string]: unknown;
}

export const llmProviderRouter = createTRPCRouter({
  read: authorizedProcedure([AiPermissions.LlmProviderReadAll, AiPermissions.LlmProviderReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const llmProvider = await trx
          .selectFrom("aiLlmProviders")
          .select(["id", "name", "description", "apiUrl", "apiType", "apiKey", "headers"])
          .where("id", "=", input.id)
          .executeTakeFirst();

        if (!llmProvider) {
          ctx.logger.warn({ llmProviderId: input.id }, "LLM provider not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "LLM provider not found",
          });
        }

        ctx.logger.debug({ llmProviderId: input.id }, "LLM provider retrieved");
        return {
          ...llmProvider,
          apiKey: HttpRedactedValue,
          headers: llmProvider.headers.map((h) => ({ name: h.name, value: HttpRedactedValue })),
        } satisfies WithRedactedValues;
      });
    }),

  search: authorizedProcedure([AiPermissions.LlmProviderListAll, AiPermissions.LlmProviderListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["name", "description", "apiUrl"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description", "apiUrl"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: PageCursorSchema.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx.selectFrom("aiLlmProviders").select(["id", "name", "description", "apiUrl"]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) =>
            eb.or(searchList.map((v) => eb(`aiLlmProviders.${searchBy}`, "ilike", `%${v}%`))),
          );
        }

        const { rows: llmProviders, nextCursor } = await paginate(query, {
          table: "aiLlmProviders",
          orderBy,
          order,
          limit,
          cursor,
        });

        ctx.logger.debug("LLM provider list retrieved");
        return { llmProviders, nextCursor };
      });
    }),

  create: authorizedProcedure([AiPermissions.LlmProviderCreate])
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().max(1000).trim().default(""),
        apiUrl: HttpUrlSchema,
        apiType: LlmProviderApiTypeSchema.default("chat-completions"),
        apiKey: z.string().max(1000).trim().default(""),
        headers: HttpHeadersSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const llmProviderId = crypto.randomUUID();

          await trx
            .insertInto("aiLlmProviders")
            .values({
              id: llmProviderId,
              name: input.name,
              description: input.description,
              apiUrl: input.apiUrl,
              apiType: input.apiType,
              apiKey: input.apiKey,
              headers: JSON.stringify(input.headers ?? []),
            })
            .execute();

          await grantResourceAccess(trx, LlmProviderResource, llmProviderId, [
            { id: ctx.user.id, type: "user", role: "editor" },
            { id: ctx.user.id, type: "user", role: "user" },
          ]);

          const llmProvider = await trx
            .selectFrom("aiLlmProviders")
            .select(["id", "name", "description", "apiUrl", "apiType", "apiKey", "headers"])
            .where("id", "=", llmProviderId)
            .executeTakeFirstOrThrow();

          ctx.logger.info({ llmProviderId }, "LLM provider created");
          return {
            ...llmProvider,
            apiKey: HttpRedactedValue,
            headers: llmProvider.headers.map((h) => ({ name: h.name, value: HttpRedactedValue })),
          } satisfies WithRedactedValues;
        } catch (error) {
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ name: input.name }, "LLM provider name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "An LLM provider with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  update: authorizedProcedure([AiPermissions.LlmProviderUpdateAll, AiPermissions.LlmProviderUpdateOwn])
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(1000).trim().optional(),
        apiUrl: HttpUrlSchema.optional(),
        apiType: LlmProviderApiTypeSchema.optional(),
        apiKey: z.string().max(1000).trim().optional(),
        headers: HttpHeadersSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, apiUrl, apiKey, headers, ...updateData } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const existing = await trx
            .selectFrom("aiLlmProviders")
            .select(["apiUrl as url", "apiKey", "headers"])
            .where("id", "=", id)
            .forUpdate()
            .executeTakeFirst();
          const endpoint = unredactEndpoint({ url: apiUrl, apiKey, headers }, existing);

          const llmProvider = await trx
            .updateTable("aiLlmProviders")
            .set({
              ...updateData,
              apiUrl: endpoint.url,
              apiKey: endpoint.apiKey,
              headers: JSON.stringify(endpoint.headers),
              updatedAt: new Date(),
            })
            .where("id", "=", id)
            .returning(["id", "name", "description", "apiUrl", "apiType", "apiKey", "headers"])
            .executeTakeFirst();

          if (!llmProvider) {
            ctx.logger.warn({ llmProviderId: id }, "LLM provider not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "LLM provider not found or you don't have permission to update it",
            });
          }

          ctx.logger.info({ llmProviderId: id }, "LLM provider updated");
          return {
            ...llmProvider,
            apiKey: HttpRedactedValue,
            headers: llmProvider.headers.map((h) => ({ name: h.name, value: HttpRedactedValue })),
          } satisfies WithRedactedValues;
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to update this LLM provider",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ llmProviderId: id, name: input.name }, "LLM provider name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "An LLM provider with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  delete: authorizedProcedure([AiPermissions.LlmProviderDeleteAll, AiPermissions.LlmProviderDeleteOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("aiLlmProviders")
            .where("id", "=", input.id)
            .returning(["id"])
            .executeTakeFirst();

          if (!deleted) {
            ctx.logger.warn({ llmProviderId: input.id }, "LLM provider not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "LLM provider not found or you don't have permission to delete it",
            });
          }

          ctx.logger.info({ llmProviderId: input.id }, "LLM provider deleted");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to delete this LLM provider",
            });
          }
          if (isForeignKeyViolation(error)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Cannot delete LLM provider: it is referenced by other resources",
            });
          }
          throw error;
        }
      });
    }),

  ...sharedResourceAccessProcedures({
    resource: LlmProviderResource,
    idKey: "llmProviderId",
    label: "LLM provider",
    readPermissions: [AiPermissions.LlmProviderReadAll, AiPermissions.LlmProviderReadOwn],
    updatePermissions: [AiPermissions.LlmProviderUpdateAll, AiPermissions.LlmProviderUpdateOwn],
  }),

  testConnection: authorizedProcedure([
    AiPermissions.LlmProviderCreate,
    AiPermissions.LlmProviderUpdateAll,
    AiPermissions.LlmProviderUpdateOwn,
  ])
    .input(
      z.object({
        id: z.uuid().optional(),
        apiUrl: HttpUrlSchema,
        apiType: LlmProviderApiTypeSchema.default("chat-completions"),
        apiKey: z.string().max(1000).trim().default(""),
        headers: HttpHeadersSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, apiType } = input;

      let endpoint: Endpoint = { url: input.apiUrl, apiKey: input.apiKey, headers: input.headers ?? [] };
      if (id) {
        // The lock only returns it to those who can update it
        const stored = await withUserTransaction(ctx.user, (trx) => {
          return trx
            .selectFrom("aiLlmProviders")
            .select(["apiUrl as url", "apiKey", "headers"])
            .where("id", "=", id)
            .forUpdate()
            .executeTakeFirst();
        });
        if (!stored) {
          ctx.logger.warn({ llmProviderId: id }, "LLM provider not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "LLM provider not found or you don't have permission to update it",
          });
        }
        endpoint = unredactEndpoint(endpoint, stored);
      } else if (!can(ctx.user, AiPermissions.LlmProviderCreate)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Insufficient permissions",
        });
      }

      const llmClient = new LlmClient({
        apiUrl: endpoint.url,
        apiType,
        apiKey: endpoint.apiKey,
        headers: endpoint.headers,
      });

      return llmClient.testConnection();
    }),
});
