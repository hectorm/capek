import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { HttpRedactedHeader } from "~~/shared/http";
import type { Principal } from "~~/shared/rbac";
import { withUserTransaction } from "~~/server/lib/database";
import { isForeignKeyViolation, isRLSViolation, isUniqueViolation } from "~~/server/lib/database/errors";
import { authorizedProcedure, createTRPCRouter } from "~~/server/trpc/init";
import { HttpHeadersSchema, HttpRedactedValue } from "~~/shared/http";
import { Permissions } from "~~/shared/rbac";

interface WithRedactedValues {
  apiKey: HttpRedactedHeader["value"];
  headers: HttpRedactedHeader[];
  [key: string]: unknown;
}

export const llmProviderRouter = createTRPCRouter({
  read: authorizedProcedure([Permissions.LlmProviderReadAll, Permissions.LlmProviderReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const llmProvider = await trx
          .selectFrom("llmProviders")
          .select(["id", "name", "description", "apiUrl", "apiKey", "headers"])
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

  search: authorizedProcedure([Permissions.LlmProviderListAll, Permissions.LlmProviderListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["name", "description", "apiUrl"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description", "apiUrl"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.uuid().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx.selectFrom("llmProviders").select(["id", "name", "description", "apiUrl", "apiKey", "headers"]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb(`llmProviders.${searchBy}`, "ilike", `%${v}%`))));
        }

        // Apply cursor-based pagination
        if (cursor) {
          const cursorLlmProvider = await trx
            .selectFrom("llmProviders")
            .select(["id", orderBy])
            .where("id", "=", cursor)
            .executeTakeFirst();

          if (cursorLlmProvider) {
            if (order === "asc") {
              query = query.where((eb) =>
                eb.or([
                  eb(`llmProviders.${orderBy}`, ">", cursorLlmProvider[orderBy]),
                  eb.and([
                    eb(`llmProviders.${orderBy}`, "=", cursorLlmProvider[orderBy]),
                    eb("llmProviders.id", ">", cursorLlmProvider.id),
                  ]),
                ]),
              );
            } else {
              query = query.where((eb) =>
                eb.or([
                  eb(`llmProviders.${orderBy}`, "<", cursorLlmProvider[orderBy]),
                  eb.and([
                    eb(`llmProviders.${orderBy}`, "=", cursorLlmProvider[orderBy]),
                    eb("llmProviders.id", "<", cursorLlmProvider.id),
                  ]),
                ]),
              );
            }
          }
        }

        // Apply ordering and limit
        query = query
          .orderBy(`llmProviders.${orderBy}`, order)
          .orderBy("llmProviders.id", order)
          .limit(limit + 1);

        const llmProviders = await query.execute();

        let nextCursor: string | undefined = undefined;
        if (llmProviders.length > limit) {
          llmProviders.pop();
          nextCursor = llmProviders[llmProviders.length - 1]?.id;
        }

        ctx.logger.debug("LLM provider list retrieved");
        return {
          llmProviders: llmProviders.map((p) => {
            return {
              ...p,
              apiKey: HttpRedactedValue,
              headers: p.headers.map((h) => ({ name: h.name, value: HttpRedactedValue })),
            } satisfies WithRedactedValues;
          }),
          nextCursor,
        };
      });
    }),

  create: authorizedProcedure([Permissions.LlmProviderCreate])
    .input(
      z.object({
        name: z.string().min(1).max(100).trim(),
        description: z.string().max(1000).trim().default(""),
        apiUrl: z.url(),
        apiKey: z.string().max(1000).trim().default(""),
        headers: HttpHeadersSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const llmProviderId = crypto.randomUUID();

          await trx
            .insertInto("llmProviders")
            .values({
              id: llmProviderId,
              name: input.name,
              description: input.description,
              apiUrl: input.apiUrl,
              apiKey: input.apiKey,
              headers: JSON.stringify(input.headers ?? []),
            })
            .execute();

          await trx
            .insertInto("llmProviderAccess")
            .values([
              { llmProviderId, userId: ctx.user.id, groupId: null, role: "editor" },
              { llmProviderId, userId: ctx.user.id, groupId: null, role: "user" },
            ])
            .execute();

          const llmProvider = await trx
            .selectFrom("llmProviders")
            .select(["id", "name", "description", "apiUrl", "apiKey", "headers"])
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

  update: authorizedProcedure([Permissions.LlmProviderUpdateAll, Permissions.LlmProviderUpdateOwn])
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(100).trim().optional(),
        description: z.string().max(1000).trim().optional(),
        apiUrl: z.url().optional(),
        apiKey: z.string().max(1000).trim().optional(),
        headers: HttpHeadersSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          if (updateData.headers !== undefined) {
            const existing = await trx
              .selectFrom("llmProviders")
              .select(["headers"])
              .where("id", "=", id)
              .executeTakeFirst();
            updateData.headers = updateData.headers.map((h) => {
              return h.value === HttpRedactedValue
                ? { ...h, value: existing?.headers.find((e) => e.name === h.name)?.value ?? "" }
                : h;
            });
          }

          const apiKey = updateData.apiKey === HttpRedactedValue ? undefined : updateData.apiKey;
          const headers = updateData.headers ? JSON.stringify(updateData.headers) : undefined;

          const llmProvider = await trx
            .updateTable("llmProviders")
            .set({ ...updateData, apiKey, headers, updatedAt: new Date() })
            .where("id", "=", id)
            .returning(["id", "name", "description", "apiUrl", "apiKey", "headers"])
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

  delete: authorizedProcedure([Permissions.LlmProviderDeleteAll, Permissions.LlmProviderDeleteOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("llmProviders")
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

  listAccess: authorizedProcedure([Permissions.LlmProviderReadAll, Permissions.LlmProviderReadOwn])
    .input(z.object({ llmProviderId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const access = await trx
          .selectFrom("llmProviderAccess")
          .leftJoin("users", "users.id", "llmProviderAccess.userId")
          .leftJoin("groups", "groups.id", "llmProviderAccess.groupId")
          .select([
            "llmProviderAccess.llmProviderId",
            "llmProviderAccess.userId",
            "llmProviderAccess.groupId",
            "llmProviderAccess.role",
            "users.username",
            "users.email",
            "groups.name as groupname",
          ])
          .where("llmProviderAccess.llmProviderId", "=", input.llmProviderId)
          .execute();

        const mapped: Principal[] = [];
        for (const a of access) {
          if (a.userId !== null && a.username !== null && a.email !== null) {
            mapped.push({ id: a.userId, type: "user", role: a.role, username: a.username, email: a.email });
          } else if (a.groupId !== null && a.groupname !== null) {
            mapped.push({ id: a.groupId, type: "group", role: a.role, groupname: a.groupname });
          }
        }

        ctx.logger.debug({ llmProviderId: input.llmProviderId }, "LLM provider access list retrieved");
        return mapped;
      });
    }),

  syncAccess: authorizedProcedure([Permissions.LlmProviderUpdateAll, Permissions.LlmProviderUpdateOwn])
    .input(
      z.object({
        llmProviderId: z.uuid(),
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
            .selectFrom("llmProviderAccess")
            .select(["userId", "groupId", "role"])
            .where("llmProviderId", "=", input.llmProviderId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.access.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("llmProviderAccess").where("llmProviderId", "=", input.llmProviderId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("llmProviderAccess")
              .values(
                input.access.map((a) => ({
                  llmProviderId: input.llmProviderId,
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
                    .deleteFrom("llmProviderAccess")
                    .where("llmProviderId", "=", input.llmProviderId)
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
                    .insertInto("llmProviderAccess")
                    .values(
                      toAdd.map((a) => ({
                        llmProviderId: input.llmProviderId,
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

          ctx.logger.info({ llmProviderId: input.llmProviderId, added, removed }, "LLM provider access synchronized");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to manage access for this LLM provider",
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
