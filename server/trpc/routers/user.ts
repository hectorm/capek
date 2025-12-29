import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod/v4";

import type { AuthUser } from "~~/server/lib/authn/strategies";
import { syncUserGroups, syncUserRoles } from "~~/server/lib/authn/sync";
import { withUserTransaction } from "~~/server/lib/database";
import { isRLSViolation, isUniqueViolation } from "~~/server/lib/database/errors";
import { authorizedProcedure, createTRPCRouter, publicProcedure } from "~~/server/trpc/init";
import { Permissions } from "~~/shared/rbac";

export const userRouter = createTRPCRouter({
  me: publicProcedure.query(({ ctx }): Omit<AuthUser, "lastLoginAt" | "createdAt" | "updatedAt"> | null => {
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
    };
  }),

  read: authorizedProcedure([Permissions.UserReadAll, Permissions.UserReadOwn])
    .input(
      z.object({
        id: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const user = await trx
          .selectFrom("users")
          .select([
            "users.id",
            "users.username",
            "users.fullname",
            "users.email",
            "users.createdAt",
            "users.updatedAt",
            (eb) =>
              eb
                .selectFrom("userGroups")
                .innerJoin("groups", "groups.id", "userGroups.groupId")
                .select(
                  sql<
                    string[]
                  >`COALESCE(jsonb_agg(groups.name) FILTER (WHERE groups.name IS NOT NULL), '[]'::jsonb)`.as("value"),
                )
                .whereRef("userGroups.userId", "=", "users.id")
                .as("groups"),
            (eb) =>
              eb
                .selectFrom("userRoles")
                .innerJoin("roles", "roles.id", "userRoles.roleId")
                .select(
                  sql<string[]>`COALESCE(jsonb_agg(roles.name) FILTER (WHERE roles.name IS NOT NULL), '[]'::jsonb)`.as(
                    "value",
                  ),
                )
                .whereRef("userRoles.userId", "=", "users.id")
                .as("roles"),
          ])
          .where("users.id", "=", input.id)
          .executeTakeFirst();

        if (!user) {
          ctx.logger.warn({ userId: input.id }, "User not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        ctx.logger.debug({ userId: input.id }, "User retrieved");
        return { ...user, roles: user.roles ?? [], groups: user.groups ?? [] };
      });
    }),

  search: authorizedProcedure([Permissions.UserListAll])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["username", "fullname", "email", "roles", "groups"]).default("username"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["username", "fullname", "email"]).default("username"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.uuid().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx.selectFrom("users").select([
          "users.id",
          "users.username",
          "users.fullname",
          "users.email",
          "users.createdAt",
          "users.updatedAt",
          (eb) =>
            eb
              .selectFrom("userGroups")
              .innerJoin("groups", "groups.id", "userGroups.groupId")
              .select(
                sql<string[]>`COALESCE(jsonb_agg(groups.name) FILTER (WHERE groups.name IS NOT NULL), '[]'::jsonb)`.as(
                  "value",
                ),
              )
              .whereRef("userGroups.userId", "=", "users.id")
              .as("groups"),
          (eb) =>
            eb
              .selectFrom("userRoles")
              .innerJoin("roles", "roles.id", "userRoles.roleId")
              .select(
                sql<string[]>`COALESCE(jsonb_agg(roles.name) FILTER (WHERE roles.name IS NOT NULL), '[]'::jsonb)`.as(
                  "value",
                ),
              )
              .whereRef("userRoles.userId", "=", "users.id")
              .as("roles"),
        ]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];

          if (searchBy === "roles") {
            query = query.where((eb) =>
              eb.exists(
                eb
                  .selectFrom("userRoles")
                  .innerJoin("roles", "roles.id", "userRoles.roleId")
                  .whereRef("userRoles.userId", "=", "users.id")
                  .where((eb2) => eb2.or(searchList.map((v) => eb2("roles.name", "ilike", `%${v}%`)))),
              ),
            );
          } else if (searchBy === "groups") {
            query = query.where((eb) =>
              eb.exists(
                eb
                  .selectFrom("userGroups")
                  .innerJoin("groups", "groups.id", "userGroups.groupId")
                  .whereRef("userGroups.userId", "=", "users.id")
                  .where((eb2) => eb2.or(searchList.map((v) => eb2("groups.name", "ilike", `%${v}%`)))),
              ),
            );
          } else {
            query = query.where((eb) => eb.or(searchList.map((v) => eb(`users.${searchBy}`, "ilike", `%${v}%`))));
          }
        }

        // Apply cursor-based pagination
        if (cursor) {
          const cursorUser = await trx
            .selectFrom("users")
            .select(["id", orderBy])
            .where("id", "=", cursor)
            .executeTakeFirst();

          if (cursorUser) {
            if (order === "asc") {
              query = query.where((eb) =>
                eb.or([
                  eb(`users.${orderBy}`, ">", cursorUser[orderBy]),
                  eb.and([eb(`users.${orderBy}`, "=", cursorUser[orderBy]), eb("users.id", ">", cursorUser.id)]),
                ]),
              );
            } else {
              query = query.where((eb) =>
                eb.or([
                  eb(`users.${orderBy}`, "<", cursorUser[orderBy]),
                  eb.and([eb(`users.${orderBy}`, "=", cursorUser[orderBy]), eb("users.id", "<", cursorUser.id)]),
                ]),
              );
            }
          }
        }

        // Apply ordering and limit
        query = query
          .orderBy(`users.${orderBy}`, order)
          .orderBy("users.id", order)
          .limit(limit + 1);

        const users = await query.execute();

        let nextCursor: string | undefined = undefined;
        if (users.length > limit) {
          users.pop();
          nextCursor = users[users.length - 1]?.id;
        }

        const usersWithDefaults = users.map((u) => ({
          ...u,
          roles: u.roles ?? [],
          groups: u.groups ?? [],
        }));

        ctx.logger.debug("User list retrieved");
        return { users: usersWithDefaults, nextCursor };
      });
    }),

  create: authorizedProcedure([Permissions.UserCreate])
    .input(
      z.object({
        username: z.string().min(1).max(255).trim(),
        fullname: z.string().min(1).max(255).trim(),
        email: z.email({ pattern: z.regexes.unicodeEmail }).max(255).trim().toLowerCase(),
        roles: z.array(z.string().min(1).max(255).trim().toLowerCase()).max(255).optional(),
        groups: z.array(z.string().min(1).max(255).trim()).max(255).optional(),
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
                  .expression((eb) =>
                    eb
                      .selectFrom("roles")
                      .select([eb.val(insertedUser.id).as("userId"), "roles.id as roleId"])
                      .where("roles.name", "in", roles),
                  )
                  .execute(),
              );
            }
            if (input.groups && input.groups.length > 0) {
              const groups = input.groups;
              insertOps.push(
                trx
                  .insertInto("userGroups")
                  .columns(["userId", "groupId"])
                  .expression((eb) =>
                    eb
                      .selectFrom("groups")
                      .select([eb.val(insertedUser.id).as("userId"), "groups.id as groupId"])
                      .where("groups.name", "in", groups),
                  )
                  .execute(),
              );
            }
            await Promise.all(insertOps);
          }

          const user = await trx
            .selectFrom("users")
            .select([
              "users.id",
              "users.username",
              "users.fullname",
              "users.email",
              "users.createdAt",
              "users.updatedAt",
              (eb) =>
                eb
                  .selectFrom("userGroups")
                  .innerJoin("groups", "groups.id", "userGroups.groupId")
                  .select(
                    sql<
                      string[]
                    >`COALESCE(jsonb_agg(groups.name) FILTER (WHERE groups.name IS NOT NULL), '[]'::jsonb)`.as("value"),
                  )
                  .whereRef("userGroups.userId", "=", "users.id")
                  .as("groups"),
              (eb) =>
                eb
                  .selectFrom("userRoles")
                  .innerJoin("roles", "roles.id", "userRoles.roleId")
                  .select(
                    sql<
                      string[]
                    >`COALESCE(jsonb_agg(roles.name) FILTER (WHERE roles.name IS NOT NULL), '[]'::jsonb)`.as("value"),
                  )
                  .whereRef("userRoles.userId", "=", "users.id")
                  .as("roles"),
            ])
            .where("users.id", "=", insertedUser.id)
            .executeTakeFirstOrThrow();

          ctx.logger.info({ userId: user.id }, "User created");
          return { ...user, roles: user.roles ?? [], groups: user.groups ?? [] };
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

  update: authorizedProcedure([Permissions.UserUpdateAll, Permissions.UserUpdateOwn])
    .input(
      z.object({
        id: z.uuid(),
        username: z.string().min(1).max(255).trim().optional(),
        fullname: z.string().min(1).max(255).trim().optional(),
        email: z.email({ pattern: z.regexes.unicodeEmail }).max(255).trim().toLowerCase().optional(),
        roles: z.array(z.string().min(1).max(255).trim().toLowerCase()).max(255).optional(),
        groups: z.array(z.string().min(1).max(255).trim()).max(255).optional(),
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

          const user = await trx
            .selectFrom("users")
            .select([
              "users.id",
              "users.username",
              "users.fullname",
              "users.email",
              "users.createdAt",
              "users.updatedAt",
              (eb) =>
                eb
                  .selectFrom("userGroups")
                  .innerJoin("groups", "groups.id", "userGroups.groupId")
                  .select(
                    sql<
                      string[]
                    >`COALESCE(jsonb_agg(groups.name) FILTER (WHERE groups.name IS NOT NULL), '[]'::jsonb)`.as("value"),
                  )
                  .whereRef("userGroups.userId", "=", "users.id")
                  .as("groups"),
              (eb) =>
                eb
                  .selectFrom("userRoles")
                  .innerJoin("roles", "roles.id", "userRoles.roleId")
                  .select(
                    sql<
                      string[]
                    >`COALESCE(jsonb_agg(roles.name) FILTER (WHERE roles.name IS NOT NULL), '[]'::jsonb)`.as("value"),
                  )
                  .whereRef("userRoles.userId", "=", "users.id")
                  .as("roles"),
            ])
            .where("users.id", "=", input.id)
            .executeTakeFirstOrThrow();

          ctx.logger.info({ userId: user.id }, "User updated");
          return { ...user, roles: user.roles ?? [], groups: user.groups ?? [] };
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

  delete: authorizedProcedure([Permissions.UserDeleteAll])
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
