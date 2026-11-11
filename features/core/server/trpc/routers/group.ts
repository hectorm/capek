import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod/v4";

import { syncGroupRoles } from "#layers/core/server/lib/authn/sync";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { paginate } from "#layers/core/server/lib/database/pagination";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";
import { CorePermissions } from "#layers/core/shared/rbac";

export const groupRouter = createTRPCRouter({
  read: authorizedProcedure([CorePermissions.GroupReadAll, CorePermissions.GroupReadOwn])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const group = await trx
          .selectFrom("groups")
          .select([
            "groups.id",
            "groups.name",
            "groups.description",
            (eb) =>
              eb
                .selectFrom("groupRoles")
                .innerJoin("roles", "roles.id", "groupRoles.roleId")
                .select(
                  sql<string[]>`COALESCE(jsonb_agg(roles.name) FILTER (WHERE roles.name IS NOT NULL), '[]'::jsonb)`.as(
                    "value",
                  ),
                )
                .whereRef("groupRoles.groupId", "=", "groups.id")
                .as("roles"),
          ])
          .where("groups.id", "=", input.id)
          .executeTakeFirst();

        if (!group) {
          ctx.logger.warn({ groupId: input.id }, "Group not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Group not found",
          });
        }

        ctx.logger.debug({ groupId: input.id }, "Group retrieved");
        return { ...group, roles: group.roles ?? [] };
      });
    }),

  search: authorizedProcedure([CorePermissions.GroupListAll, CorePermissions.GroupListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["name", "description", "roles"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.uuid().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx.selectFrom("groups").select([
          "groups.id",
          "groups.name",
          "groups.description",
          (eb) =>
            eb
              .selectFrom("groupRoles")
              .innerJoin("roles", "roles.id", "groupRoles.roleId")
              .select(
                sql<string[]>`COALESCE(jsonb_agg(roles.name) FILTER (WHERE roles.name IS NOT NULL), '[]'::jsonb)`.as(
                  "value",
                ),
              )
              .whereRef("groupRoles.groupId", "=", "groups.id")
              .as("roles"),
        ]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];

          if (searchBy === "roles") {
            query = query.where((eb) =>
              eb.exists(
                eb
                  .selectFrom("groupRoles")
                  .innerJoin("roles", "roles.id", "groupRoles.roleId")
                  .whereRef("groupRoles.groupId", "=", "groups.id")
                  .where((eb2) => eb2.or(searchList.map((v) => eb2("roles.name", "ilike", `%${v}%`)))),
              ),
            );
          } else {
            query = query.where((eb) => eb.or(searchList.map((v) => eb(`groups.${searchBy}`, "ilike", `%${v}%`))));
          }
        }

        const { rows: groups, nextCursor } = await paginate(query, {
          table: "groups",
          orderBy,
          order,
          limit,
          cursor,
        });

        const groupsWithDefaults = groups.map((g) => ({
          ...g,
          roles: g.roles ?? [],
        }));

        ctx.logger.debug("Group list retrieved");
        return { groups: groupsWithDefaults, nextCursor };
      });
    }),

  create: authorizedProcedure([CorePermissions.GroupCreate])
    .input(
      z.object({
        name: z.string().min(1).max(255).trim(),
        description: z.string().max(1000).trim().default(""),
        roles: z.array(z.string().min(1).max(255).trim().toLowerCase()).max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const insertedGroup = await trx
            .insertInto("groups")
            .values({
              name: input.name,
              description: input.description,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (input.roles && input.roles.length > 0) {
            const roles = input.roles;
            await trx
              .insertInto("groupRoles")
              .columns(["groupId", "roleId"])
              .expression((eb) =>
                eb
                  .selectFrom("roles")
                  .select([eb.val(insertedGroup.id).as("groupId"), "roles.id as roleId"])
                  .where("roles.name", "in", roles),
              )
              .execute();
          }

          const group = await trx
            .selectFrom("groups")
            .select([
              "groups.id",
              "groups.name",
              "groups.description",
              (eb) =>
                eb
                  .selectFrom("groupRoles")
                  .innerJoin("roles", "roles.id", "groupRoles.roleId")
                  .select(
                    sql<
                      string[]
                    >`COALESCE(jsonb_agg(roles.name) FILTER (WHERE roles.name IS NOT NULL), '[]'::jsonb)`.as("value"),
                  )
                  .whereRef("groupRoles.groupId", "=", "groups.id")
                  .as("roles"),
            ])
            .where("groups.id", "=", insertedGroup.id)
            .executeTakeFirstOrThrow();

          ctx.logger.info({ groupId: group.id }, "Group created");
          return { ...group, roles: group.roles ?? [] };
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to create groups",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ name: input.name }, "Group name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "A group with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  update: authorizedProcedure([CorePermissions.GroupUpdateAll])
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(255).trim().optional(),
        description: z.string().max(1000).trim().optional(),
        roles: z.array(z.string().min(1).max(255).trim().toLowerCase()).max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          if (input.name != null || input.description != null) {
            const updateData: { name?: string; description?: string; updatedAt: Date } = {
              updatedAt: new Date(),
            };

            if (input.name != null) {
              updateData.name = input.name;
            }
            if (input.description != null) {
              updateData.description = input.description;
            }

            const updated = await trx
              .updateTable("groups")
              .set(updateData)
              .where("id", "=", input.id)
              .returning(["id"])
              .executeTakeFirst();

            if (!updated) {
              ctx.logger.warn({ groupId: input.id }, "Group not found");
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Group not found or you don't have permission to update it",
              });
            }
          }

          if (input.roles != null) {
            await syncGroupRoles(input.id, input.roles, trx);
          }

          const group = await trx
            .selectFrom("groups")
            .select([
              "groups.id",
              "groups.name",
              "groups.description",
              (eb) =>
                eb
                  .selectFrom("groupRoles")
                  .innerJoin("roles", "roles.id", "groupRoles.roleId")
                  .select(
                    sql<
                      string[]
                    >`COALESCE(jsonb_agg(roles.name) FILTER (WHERE roles.name IS NOT NULL), '[]'::jsonb)`.as("value"),
                  )
                  .whereRef("groupRoles.groupId", "=", "groups.id")
                  .as("roles"),
            ])
            .where("groups.id", "=", input.id)
            .executeTakeFirstOrThrow();

          ctx.logger.info({ groupId: group.id }, "Group updated");
          return { ...group, roles: group.roles ?? [] };
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to update this group",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ groupId: input.id, name: input.name }, "Group name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "A group with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  delete: authorizedProcedure([CorePermissions.GroupDeleteAll])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("groups")
            .where("id", "=", input.id)
            .returning(["id"])
            .executeTakeFirst();

          if (!deleted) {
            ctx.logger.warn({ groupId: input.id }, "Group not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Group not found or you don't have permission to delete it",
            });
          }

          ctx.logger.info({ groupId: input.id }, "Group deleted");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to delete this group",
            });
          }
          throw error;
        }
      });
    }),
});
