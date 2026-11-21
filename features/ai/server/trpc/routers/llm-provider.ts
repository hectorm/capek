import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { Endpoint } from "#layers/core/server/lib/http";
import type { HttpRedactedHeader } from "#layers/core/shared/http";
import { LlmClient } from "#layers/ai/server/lib/llm/client";
import { LlmProviderResource } from "#layers/ai/server/lib/resources";
import { decryptLlmProviderSecrets, encryptLlmProviderSecrets } from "#layers/ai/server/lib/secrets";
import { LlmProviderApiTypeSchema } from "#layers/ai/shared/llm-provider";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { can } from "#layers/core/server/lib/authz/permissions";
import { grantResourceAccess } from "#layers/core/server/lib/authz/resources";
import { withResourceTransaction, withUserTransaction } from "#layers/core/server/lib/database";
import { isForeignKeyViolation, isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import {
  ListPageSizeSchema,
  PageCursorSchema,
  paginate,
  SearchTermsSchema,
} from "#layers/core/server/lib/database/pagination";
import { unredactEndpoint } from "#layers/core/server/lib/http";
import {
  ResourceAccessSchema,
  sharedResourceAccessProcedures,
  syncSharedResourceAccess,
} from "#layers/core/server/trpc/access";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";
import { HTTP_REDACTED_VALUE, HttpHeadersSchema, HttpUrlSchema } from "#layers/core/shared/http";

type WithRedactedSecrets<T> = Omit<T, "apiKey" | "headers"> & {
  apiKey: HttpRedactedHeader["value"];
  headers: HttpRedactedHeader[];
};

const redactSecrets = <T extends { apiKey: string; headers: string }>(llmProvider: T): WithRedactedSecrets<T> => {
  const { headers } = decryptLlmProviderSecrets(llmProvider);
  return {
    ...llmProvider,
    apiKey: HTTP_REDACTED_VALUE,
    headers: headers.map((h) => ({ name: h.name, value: HTTP_REDACTED_VALUE })),
  };
};

const storedEndpoint = (stored: { url: string; apiKey: string; headers: string }): Endpoint => {
  return { url: stored.url, ...decryptLlmProviderSecrets(stored) };
};

export const llmProviderRouter = createTRPCRouter({
  read: authorizedProcedure([AiPermissions.LlmProviderReadAll, AiPermissions.LlmProviderReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withResourceTransaction(ctx.user, LlmProviderResource.type, "read", async (trx) => {
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
        return redactSecrets(llmProvider);
      });
    }),

  search: authorizedProcedure([AiPermissions.LlmProviderListAll, AiPermissions.LlmProviderListOwn])
    .input(
      z.object({
        search: SearchTermsSchema,
        searchBy: z.enum(["name", "description", "apiUrl"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description", "apiUrl"]).default("name"),
        limit: ListPageSizeSchema,
        cursor: PageCursorSchema.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withResourceTransaction(ctx.user, LlmProviderResource.type, "list", async (trx) => {
        let query = trx.selectFrom("aiLlmProviders").select(["id", "name", "description", "apiUrl"]);

        if (search.length > 0) {
          query = query.where((eb) => {
            return eb.or(search.map((v) => eb(`aiLlmProviders.${searchBy}`, "ilike", `%${v}%`)));
          });
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
        access: ResourceAccessSchema.optional(),
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
              ...encryptLlmProviderSecrets({ apiKey: input.apiKey, headers: input.headers ?? [] }),
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

          await syncSharedResourceAccess(trx, LlmProviderResource, llmProviderId, input.access, "LLM provider");

          ctx.logger.info({ llmProviderId }, "LLM provider created");
          return redactSecrets(llmProvider);
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
        access: ResourceAccessSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, access, apiUrl, apiKey, headers, ...updateData } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const existing = await trx
            .selectFrom("aiLlmProviders")
            .select(["apiUrl as url", "apiKey", "headers"])
            .where("id", "=", id)
            .forUpdate()
            .executeTakeFirst();
          const endpoint = unredactEndpoint(
            { url: apiUrl, apiKey, headers },
            existing ? storedEndpoint(existing) : undefined,
          );

          const llmProvider = await trx
            .updateTable("aiLlmProviders")
            .set({
              ...updateData,
              apiUrl: endpoint.url,
              ...encryptLlmProviderSecrets({ apiKey: endpoint.apiKey, headers: endpoint.headers }),
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

          await syncSharedResourceAccess(trx, LlmProviderResource, id, access, "LLM provider");

          ctx.logger.info({ llmProviderId: id }, "LLM provider updated");
          return redactSecrets(llmProvider);
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
              message: "This LLM provider is used by other resources and cannot be deleted",
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
        // FOR UPDATE applies the update policy before reading stored secrets
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
        endpoint = unredactEndpoint(endpoint, storedEndpoint(stored));
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
