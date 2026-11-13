import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { ServerDatasourceType } from "#layers/datasources/server/lib/drivers";
import type { DatasourceConfig } from "#layers/datasources/shared/datasource";
import { can } from "#layers/core/server/lib/authz/permissions";
import { grantResourceAccess } from "#layers/core/server/lib/authz/resources";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { PageCursorSchema, paginate } from "#layers/core/server/lib/database/pagination";
import { sharedResourceAccessProcedures } from "#layers/core/server/trpc/access";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";
import { findDatasourceType } from "#layers/datasources/server/lib/drivers";
import { testConnection } from "#layers/datasources/server/lib/query";
import { SourceResource } from "#layers/datasources/server/lib/resources";
import { decryptSourceConfig, encryptSourceConfig } from "#layers/datasources/server/lib/secrets";
import { DatasourceConfigSchema, DatasourceSecretsError } from "#layers/datasources/shared/datasource";
import { DatasourcesPermissions } from "#layers/datasources/shared/rbac";

const typedConfigShape = {
  type: z.string().min(1).max(100),
  config: DatasourceConfigSchema,
};

// The type has to be supported, since it validates the configuration and runs the queries
const requireDatasourceType = (type: string): ServerDatasourceType => {
  const datasourceType = findDatasourceType(type);
  if (!datasourceType) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Datasource type "${type}" is not supported`,
    });
  }
  return datasourceType;
};

const parseConfig = (datasourceType: ServerDatasourceType, config: DatasourceConfig): DatasourceConfig => {
  const parsed = datasourceType.definition.configSchema.safeParse(config);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid datasource configuration",
      cause: parsed.error,
    });
  }
  return parsed.data as DatasourceConfig;
};

// Takes the hidden secrets of a configuration from the stored one
const unredactConfig = (
  datasourceType: ServerDatasourceType,
  incoming: DatasourceConfig,
  stored: { type: string; config: string } | undefined,
): DatasourceConfig => {
  try {
    return datasourceType.definition.unredact(
      incoming,
      stored?.type === datasourceType.definition.type ? decryptSourceConfig(stored.config) : {},
    );
  } catch (error) {
    if (error instanceof DatasourceSecretsError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
};

// Hides the secrets of the configuration, which cannot be read back when its type is not supported
const redactConfig = (source: { type: string; config: string }): DatasourceConfig => {
  return findDatasourceType(source.type)?.definition.redact(decryptSourceConfig(source.config)) ?? {};
};

export const sourceRouter = createTRPCRouter({
  read: authorizedProcedure([DatasourcesPermissions.SourceReadAll, DatasourcesPermissions.SourceReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const source = await trx
          .selectFrom("datasourcesSources")
          .select(["id", "name", "description", "documentation", "type", "config"])
          .where("id", "=", input.id)
          .executeTakeFirst();

        if (!source) {
          ctx.logger.warn({ sourceId: input.id }, "Datasource not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Datasource not found",
          });
        }

        ctx.logger.debug({ sourceId: input.id }, "Datasource retrieved");
        return { ...source, config: redactConfig(source) };
      });
    }),

  search: authorizedProcedure([DatasourcesPermissions.SourceListAll, DatasourcesPermissions.SourceListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["name", "description", "type"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description", "type"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: PageCursorSchema.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx.selectFrom("datasourcesSources").select(["id", "name", "description", "type"]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => {
            return eb.or(searchList.map((v) => eb(`datasourcesSources.${searchBy}`, "ilike", `%${v}%`)));
          });
        }

        const { rows: sources, nextCursor } = await paginate(query, {
          table: "datasourcesSources",
          orderBy,
          order,
          limit,
          cursor,
        });

        ctx.logger.debug("Datasource list retrieved");
        return { sources, nextCursor };
      });
    }),

  create: authorizedProcedure([DatasourcesPermissions.SourceCreate])
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().max(1000).trim().default(""),
        documentation: z
          .string()
          .max(100000)
          .trim()
          .transform((v) => v || null)
          .nullish(),
        ...typedConfigShape,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const config = parseConfig(requireDatasourceType(input.type), input.config);

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const sourceId = crypto.randomUUID();

          await trx
            .insertInto("datasourcesSources")
            .values({
              id: sourceId,
              name: input.name,
              description: input.description,
              documentation: input.documentation ?? null,
              type: input.type,
              config: encryptSourceConfig(config),
            })
            .execute();

          await grantResourceAccess(trx, SourceResource, sourceId, [
            { id: ctx.user.id, type: "user", role: "editor" },
            { id: ctx.user.id, type: "user", role: "user" },
          ]);

          const source = await trx
            .selectFrom("datasourcesSources")
            .select(["id", "name", "description", "documentation", "type", "config"])
            .where("id", "=", sourceId)
            .executeTakeFirstOrThrow();

          ctx.logger.info({ sourceId }, "Datasource created");
          return { ...source, config: redactConfig(source) };
        } catch (error) {
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ name: input.name }, "Datasource name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "A datasource with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  update: authorizedProcedure([DatasourcesPermissions.SourceUpdateAll, DatasourcesPermissions.SourceUpdateOwn])
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(1000).trim().optional(),
        documentation: z
          .string()
          .max(100000)
          .trim()
          .transform((v) => v || null)
          .nullish(),
        ...typedConfigShape,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;
      const datasourceType = requireDatasourceType(updateData.type);
      const incomingConfig = parseConfig(datasourceType, updateData.config);

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const existing = await trx
            .selectFrom("datasourcesSources")
            .select(["type", "config"])
            .where("id", "=", id)
            .forUpdate()
            .executeTakeFirst();
          const config = encryptSourceConfig(unredactConfig(datasourceType, incomingConfig, existing));

          const source = await trx
            .updateTable("datasourcesSources")
            .set({ ...updateData, config, updatedAt: new Date() })
            .where("id", "=", id)
            .returning(["id", "name", "description", "documentation", "type", "config"])
            .executeTakeFirst();

          if (!source) {
            ctx.logger.warn({ sourceId: id }, "Datasource not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Datasource not found or you don't have permission to update it",
            });
          }

          ctx.logger.info({ sourceId: id }, "Datasource updated");
          return { ...source, config: redactConfig(source) };
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to update this datasource",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ sourceId: id, name: input.name }, "Datasource name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "A datasource with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  delete: authorizedProcedure([DatasourcesPermissions.SourceDeleteAll, DatasourcesPermissions.SourceDeleteOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("datasourcesSources")
            .where("id", "=", input.id)
            .returning(["id"])
            .executeTakeFirst();

          if (!deleted) {
            ctx.logger.warn({ sourceId: input.id }, "Datasource not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Datasource not found or you don't have permission to delete it",
            });
          }

          ctx.logger.info({ sourceId: input.id }, "Datasource deleted");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to delete this datasource",
            });
          }
          throw error;
        }
      });
    }),

  ...sharedResourceAccessProcedures({
    resource: SourceResource,
    idKey: "sourceId",
    label: "datasource",
    readPermissions: [DatasourcesPermissions.SourceReadAll, DatasourcesPermissions.SourceReadOwn],
    updatePermissions: [DatasourcesPermissions.SourceUpdateAll, DatasourcesPermissions.SourceUpdateOwn],
  }),

  testConnection: authorizedProcedure([
    DatasourcesPermissions.SourceCreate,
    DatasourcesPermissions.SourceUpdateAll,
    DatasourcesPermissions.SourceUpdateOwn,
  ])
    .input(z.object({ id: z.uuid().optional(), ...typedConfigShape }))
    .mutation(async ({ ctx, input }) => {
      const { id, type } = input;
      const datasourceType = requireDatasourceType(type);

      // The secrets hidden in the form are taken from the stored datasource
      let config = parseConfig(datasourceType, input.config);
      if (id) {
        // The lock only returns it to those who can update it
        const stored = await withUserTransaction(ctx.user, (trx) => {
          return trx
            .selectFrom("datasourcesSources")
            .select(["type", "config"])
            .where("id", "=", id)
            .forUpdate()
            .executeTakeFirst();
        });
        if (!stored) {
          ctx.logger.warn({ sourceId: id }, "Datasource not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Datasource not found or you don't have permission to update it",
          });
        }
        config = unredactConfig(datasourceType, config, stored);
      } else if (!can(ctx.user, DatasourcesPermissions.SourceCreate)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Insufficient permissions",
        });
      }

      return testConnection(datasourceType, { config });
    }),
});
