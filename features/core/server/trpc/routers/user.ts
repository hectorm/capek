import type { Kysely } from "kysely";
import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { useRuntimeConfig } from "nitropack/runtime/config";
import { z } from "zod/v4";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import { AuthModes } from "#layers/core/server/lib/authn/strategies";
import { syncUserGroups, syncUserRoles } from "#layers/core/server/lib/authn/sync";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { PageCursorSchema, paginate } from "#layers/core/server/lib/database/pagination";
import { authorizedProcedure, createTRPCRouter, publicProcedure } from "#layers/core/server/trpc/init";
import { CorePermissions } from "#layers/core/shared/rbac";

const config = useRuntimeConfig();

// Users with the names of their groups and roles
const selectUsers = (db: Kysely<Database>) => {
  return db.selectFrom("users").select([
    "users.id",
    "users.username",
    "users.fullname",
    "users.email",
    (eb) => {
      return eb
        .selectFrom("userGroups")
        .innerJoin("groups", "groups.id", "userGroups.groupId")
        .select(
          sql<string[]>`COALESCE(jsonb_agg(groups.name) FILTER (WHERE groups.name IS NOT NULL), '[]'::jsonb)`.as(
            "value",
          ),
        )
        .whereRef("userGroups.userId", "=", "users.id")
        .as("groups");
    },
    (eb) => {
      return eb
        .selectFrom("userRoles")
        .innerJoin("roles", "roles.id", "userRoles.roleId")
        .select(
          sql<string[]>`COALESCE(jsonb_agg(roles.name) FILTER (WHERE roles.name IS NOT NULL), '[]'::jsonb)`.as("value"),
        )
        .whereRef("userRoles.userId", "=", "users.id")
        .as("roles");
    },
  ]);
};

// The names are typed as nullable, although their aggregation always gives a list
const withNames = <U extends { groups: string[] | null; roles: string[] | null }>(user: U) => ({
  ...user,
  groups: user.groups ?? [],
  roles: user.roles ?? [],
});

export const userRouter = createTRPCRouter({
  me: publicProcedure.query(
    ({ ctx }): (Omit<AuthUser, "lastLoginAt" | "createdAt" | "updatedAt"> & { canLogOut: boolean }) | null => {
      if (!ctx.user) {
        return null;
      }

      return {
        id: ctx.user.id,
        username: ctx.user.username,
        fullname: ctx.user.fullname,
        email: ctx.user.email,
        picture: ctx.user.picture,
        groups: ctx.user.groups,
        permissions: ctx.user.permissions,
        canLogOut: config.authMode === AuthModes.OIDC,
      };
    },
  ),

  read: authorizedProcedure([CorePermissions.UserReadAll, CorePermissions.UserReadOwn])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const user = await selectUsers(trx).where("users.id", "=", input.id).executeTakeFirst();

        if (!user) {
          ctx.logger.warn({ userId: input.id }, "User not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        ctx.logger.debug({ userId: input.id }, "User retrieved");
        return withNames(user);
      });
    }),

  search: authorizedProcedure([CorePermissions.UserListAll])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["username", "fullname", "email", "roles", "groups"]).default("username"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["username", "fullname", "email"]).default("username"),
        limit: z.number().min(1).max(100).default(50),
        cursor: PageCursorSchema.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = selectUsers(trx);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];

          if (searchBy === "roles") {
            query = query.where((eb) => {
              return eb.exists(
                eb
                  .selectFrom("userRoles")
                  .innerJoin("roles", "roles.id", "userRoles.roleId")
                  .whereRef("userRoles.userId", "=", "users.id")
                  .where((eb2) => eb2.or(searchList.map((v) => eb2("roles.name", "ilike", `%${v}%`)))),
              );
            });
          } else if (searchBy === "groups") {
            query = query.where((eb) => {
              return eb.exists(
                eb
                  .selectFrom("userGroups")
                  .innerJoin("groups", "groups.id", "userGroups.groupId")
                  .whereRef("userGroups.userId", "=", "users.id")
                  .where((eb2) => eb2.or(searchList.map((v) => eb2("groups.name", "ilike", `%${v}%`)))),
              );
            });
          } else {
            query = query.where((eb) => eb.or(searchList.map((v) => eb(`users.${searchBy}`, "ilike", `%${v}%`))));
          }
        }

        const { rows: users, nextCursor } = await paginate(query, {
          table: "users",
          orderBy,
          order,
          limit,
          cursor,
        });

        ctx.logger.debug("User list retrieved");
        return { users: users.map(withNames), nextCursor };
      });
    }),

  create: authorizedProcedure([CorePermissions.UserCreate])
    .input(
      z.object({
        username: z.string().trim().min(1).max(255),
        fullname: z.string().trim().min(1).max(255),
        email: z.email({ pattern: z.regexes.unicodeEmail }).max(255).trim().toLowerCase(),
        roles: z.array(z.string().trim().min(1).max(255).toLowerCase()).max(255).optional(),
        groups: z.array(z.string().trim().min(1).max(255)).max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const insertedUser = await trx
            .insertInto("users")
            .values({
              username: input.username,
              fullname: input.fullname,
              email: input.email,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if ((input.roles && input.roles.length > 0) || (input.groups && input.groups.length > 0)) {
            const insertOps = [];
            if (input.roles && input.roles.length > 0) {
              const roles = input.roles;
              insertOps.push(
                trx
                  .insertInto("userRoles")
                  .columns(["userId", "roleId"])
                  .expression((eb) => {
                    return eb
                      .selectFrom("roles")
                      .select([eb.val(insertedUser.id).as("userId"), "roles.id as roleId"])
                      .where("roles.name", "in", roles);
                  })
                  .execute(),
              );
            }
            if (input.groups && input.groups.length > 0) {
              const groups = input.groups;
              insertOps.push(
                trx
                  .insertInto("userGroups")
                  .columns(["userId", "groupId"])
                  .expression((eb) => {
                    return eb
                      .selectFrom("groups")
                      .select([eb.val(insertedUser.id).as("userId"), "groups.id as groupId"])
                      .where("groups.name", "in", groups);
                  })
                  .execute(),
              );
            }
            await Promise.all(insertOps);
          }

          const user = await selectUsers(trx).where("users.id", "=", insertedUser.id).executeTakeFirstOrThrow();

          ctx.logger.info({ userId: user.id }, "User created");
          return withNames(user);
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to create users",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ username: input.username, email: input.email }, "User username or email already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "A user with this username or email already exists",
            });
          }
          throw error;
        }
      });
    }),

  update: authorizedProcedure([CorePermissions.UserUpdateAll, CorePermissions.UserUpdateOwn])
    .input(
      z.object({
        id: z.uuid(),
        username: z.string().trim().min(1).max(255).optional(),
        fullname: z.string().trim().min(1).max(255).optional(),
        email: z.email({ pattern: z.regexes.unicodeEmail }).max(255).trim().toLowerCase().optional(),
        roles: z.array(z.string().trim().min(1).max(255).toLowerCase()).max(255).optional(),
        groups: z.array(z.string().trim().min(1).max(255)).max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          if (input.username != null || input.fullname != null || input.email != null) {
            const updateData: { username?: string; fullname?: string; email?: string; updatedAt: Date } = {
              updatedAt: new Date(),
            };

            if (input.username != null) {
              updateData.username = input.username;
            }
            if (input.fullname != null) {
              updateData.fullname = input.fullname;
            }
            if (input.email != null) {
              updateData.email = input.email;
            }

            const updated = await trx
              .updateTable("users")
              .set(updateData)
              .where("id", "=", input.id)
              .returning(["id"])
              .executeTakeFirst();

            if (!updated) {
              ctx.logger.warn({ userId: input.id }, "User not found");
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "User not found or you don't have permission to update it",
              });
            }
          }

          if (input.roles != null || input.groups != null) {
            const syncOps = [];
            if (input.roles != null) {
              syncOps.push(syncUserRoles(input.id, input.roles, trx));
            }
            if (input.groups != null) {
              syncOps.push(syncUserGroups(input.id, input.groups, trx));
            }
            await Promise.all(syncOps);
          }

          const user = await selectUsers(trx).where("users.id", "=", input.id).executeTakeFirstOrThrow();

          ctx.logger.info({ userId: user.id }, "User updated");
          return withNames(user);
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to update this user",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn(
              { userId: input.id, username: input.username, email: input.email },
              "User username or email already exists",
            );
            throw new TRPCError({
              code: "CONFLICT",
              message: "A user with this username or email already exists",
            });
          }
          throw error;
        }
      });
    }),

  delete: authorizedProcedure([CorePermissions.UserDeleteAll])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.id === input.id) {
        ctx.logger.warn({ userId: input.id }, "Attempt to delete own account");
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot delete your own account",
        });
      }

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx.deleteFrom("users").where("id", "=", input.id).returning(["id"]).executeTakeFirst();

          if (!deleted) {
            ctx.logger.warn({ userId: input.id }, "User not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "User not found or you don't have permission to delete it",
            });
          }

          ctx.logger.info({ userId: input.id }, "User deleted");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to delete this user",
            });
          }
          throw error;
        }
      });
    }),
});
