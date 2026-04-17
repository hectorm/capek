import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { Principal } from "~~/shared/rbac";
import { withUserTransaction } from "~~/server/lib/database";
import { isRLSViolation, isUniqueViolation } from "~~/server/lib/database/errors";
import { parseSkillParameters, validateSkillJSDoc, validateSkillSyntax } from "~~/server/lib/skills/validator";
import { authorizedProcedure, createTRPCRouter } from "~~/server/trpc/init";
import { Permissions } from "~~/shared/rbac";

export const skillRouter = createTRPCRouter({
  read: authorizedProcedure([Permissions.SkillReadAll, Permissions.SkillReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const skill = await trx
          .selectFrom("skills")
          .select(["id", "name", "description", "documentation", "parameters", "code", "createdAt", "updatedAt"])
          .where("id", "=", input.id)
          .executeTakeFirst();

        if (!skill) {
          ctx.logger.warn({ skillId: input.id }, "Skill not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Skill not found",
          });
        }

        ctx.logger.debug({ skillId: input.id }, "Skill retrieved");
        return skill;
      });
    }),

  search: authorizedProcedure([Permissions.SkillListAll, Permissions.SkillListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["name", "description"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.uuid().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx
          .selectFrom("skills")
          .select(["id", "name", "description", "documentation", "parameters", "createdAt", "updatedAt"]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb(`skills.${searchBy}`, "ilike", `%${v}%`))));
        }

        // Apply cursor-based pagination
        if (cursor) {
          const cursorSkill = await trx
            .selectFrom("skills")
            .select(["id", orderBy])
            .where("id", "=", cursor)
            .executeTakeFirst();

          if (cursorSkill) {
            if (order === "asc") {
              query = query.where((eb) =>
                eb.or([
                  eb(`skills.${orderBy}`, ">", cursorSkill[orderBy]),
                  eb.and([eb(`skills.${orderBy}`, "=", cursorSkill[orderBy]), eb("skills.id", ">", cursorSkill.id)]),
                ]),
              );
            } else {
              query = query.where((eb) =>
                eb.or([
                  eb(`skills.${orderBy}`, "<", cursorSkill[orderBy]),
                  eb.and([eb(`skills.${orderBy}`, "=", cursorSkill[orderBy]), eb("skills.id", "<", cursorSkill.id)]),
                ]),
              );
            }
          }
        }

        // Apply ordering and limit
        query = query
          .orderBy(`skills.${orderBy}`, order)
          .orderBy("skills.id", order)
          .limit(limit + 1);

        const skills = await query.execute();

        let nextCursor: string | undefined = undefined;
        if (skills.length > limit) {
          skills.pop();
          nextCursor = skills[skills.length - 1]?.id;
        }

        ctx.logger.debug("Skill list retrieved");
        return { skills, nextCursor };
      });
    }),

  create: authorizedProcedure([Permissions.SkillCreate])
    .input(
      z.object({
        name: z.string().min(1).max(100).trim(),
        description: z.string().max(1000).trim().default(""),
        documentation: z
          .string()
          .max(100000)
          .trim()
          .transform((v) => v || null)
          .nullish(),
        code: z
          .string()
          .max(100000)
          .transform((v) => v || null)
          .nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let parameters: { type: "object"; properties: Record<string, unknown> } = { type: "object", properties: {} };

      if (input.code) {
        const jsdocResult = validateSkillJSDoc(input.code);
        if (!jsdocResult.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: jsdocResult.error,
          });
        }

        const codeResult = await validateSkillSyntax(input.code);
        if (!codeResult.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: codeResult.error,
          });
        }

        const jsdocParsed = parseSkillParameters(input.code);
        if (jsdocParsed?.parameters) {
          parameters = {
            type: "object",
            properties: jsdocParsed.parameters.properties ?? {},
          };
        }
      }

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const skillId = crypto.randomUUID();

          await trx
            .insertInto("skills")
            .values({
              id: skillId,
              name: input.name,
              description: input.description,
              documentation: input.documentation ?? null,
              parameters: JSON.stringify(parameters),
              code: input.code ?? null,
            })
            .execute();

          await trx
            .insertInto("skillAccess")
            .values([
              { skillId, userId: ctx.user.id, groupId: null, role: "editor" },
              { skillId, userId: ctx.user.id, groupId: null, role: "user" },
            ])
            .execute();

          const skill = await trx
            .selectFrom("skills")
            .select(["id", "name", "description", "documentation", "parameters", "code", "createdAt", "updatedAt"])
            .where("id", "=", skillId)
            .executeTakeFirstOrThrow();

          ctx.logger.info({ skillId }, "Skill created");
          return skill;
        } catch (error) {
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ name: input.name }, "Skill name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "A skill with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  update: authorizedProcedure([Permissions.SkillUpdateAll, Permissions.SkillUpdateOwn])
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(100).trim().optional(),
        description: z.string().max(1000).trim().optional(),
        documentation: z
          .string()
          .max(100000)
          .trim()
          .transform((v) => v || null)
          .nullish(),
        code: z
          .string()
          .max(100000)
          .transform((v) => v || null)
          .nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      let parsedParameters: string | undefined;
      if (updateData.code) {
        const jsdocResult = validateSkillJSDoc(updateData.code);
        if (!jsdocResult.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: jsdocResult.error,
          });
        }

        const codeResult = await validateSkillSyntax(updateData.code);
        if (!codeResult.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: codeResult.error,
          });
        }

        const jsdocParsed = parseSkillParameters(updateData.code);
        parsedParameters = JSON.stringify(jsdocParsed?.parameters ?? { type: "object", properties: {} });
      } else if (updateData.code === null) {
        parsedParameters = JSON.stringify({ type: "object", properties: {} });
      }

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const skill = await trx
            .updateTable("skills")
            .set({
              updatedAt: new Date(),
              name: updateData.name,
              description: updateData.description,
              documentation: updateData.documentation,
              parameters: parsedParameters,
              code: updateData.code,
            })
            .where("id", "=", id)
            .returning(["id", "name", "description", "documentation", "parameters", "code", "createdAt", "updatedAt"])
            .executeTakeFirst();

          if (!skill) {
            ctx.logger.warn({ skillId: id }, "Skill not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Skill not found or you don't have permission to update it",
            });
          }

          ctx.logger.info({ skillId: id }, "Skill updated");
          return skill;
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to update this skill",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ skillId: id, name: input.name }, "Skill name already exists");
            throw new TRPCError({
              code: "CONFLICT",
              message: "A skill with this name already exists",
            });
          }
          throw error;
        }
      });
    }),

  delete: authorizedProcedure([Permissions.SkillDeleteAll, Permissions.SkillDeleteOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("skills")
            .where("id", "=", input.id)
            .returning(["id"])
            .executeTakeFirst();

          if (!deleted) {
            ctx.logger.warn({ skillId: input.id }, "Skill not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Skill not found or you don't have permission to delete it",
            });
          }

          ctx.logger.info({ skillId: input.id }, "Skill deleted");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to delete this skill",
            });
          }
          throw error;
        }
      });
    }),

  listAccess: authorizedProcedure([Permissions.SkillReadAll, Permissions.SkillReadOwn])
    .input(z.object({ skillId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const access = await trx
          .selectFrom("skillAccess")
          .leftJoin("users", "users.id", "skillAccess.userId")
          .leftJoin("groups", "groups.id", "skillAccess.groupId")
          .select([
            "skillAccess.skillId",
            "skillAccess.userId",
            "skillAccess.groupId",
            "skillAccess.role",
            "users.username",
            "users.email",
            "groups.name as groupname",
          ])
          .where("skillAccess.skillId", "=", input.skillId)
          .execute();

        const mapped: Principal[] = [];
        for (const a of access) {
          if (a.userId !== null && a.username !== null && a.email !== null) {
            mapped.push({ id: a.userId, type: "user", role: a.role, username: a.username, email: a.email });
          } else if (a.groupId !== null && a.groupname !== null) {
            mapped.push({ id: a.groupId, type: "group", role: a.role, groupname: a.groupname });
          }
        }

        ctx.logger.debug({ skillId: input.skillId }, "Skill access list retrieved");
        return mapped;
      });
    }),

  syncAccess: authorizedProcedure([Permissions.SkillUpdateAll, Permissions.SkillUpdateOwn])
    .input(
      z.object({
        skillId: z.uuid(),
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
            .selectFrom("skillAccess")
            .select(["userId", "groupId", "role"])
            .where("skillId", "=", input.skillId)
            .execute();

          let added = 0;
          let removed = 0;

          if (input.access.length === 0) {
            if (current.length > 0) {
              await trx.deleteFrom("skillAccess").where("skillId", "=", input.skillId).execute();
              removed = current.length;
            }
          } else if (current.length === 0) {
            await trx
              .insertInto("skillAccess")
              .values(
                input.access.map((a) => ({
                  skillId: input.skillId,
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
                    .deleteFrom("skillAccess")
                    .where("skillId", "=", input.skillId)
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
                    .insertInto("skillAccess")
                    .values(
                      toAdd.map((a) => ({
                        skillId: input.skillId,
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

          ctx.logger.info({ skillId: input.skillId, added, removed }, "Skill access synchronized");
        } catch (error) {
          if (isRLSViolation(error)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to manage access for this skill",
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
