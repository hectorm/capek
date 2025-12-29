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

        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb(`skills.${searchBy}`, "ilike", `%${v}%`))));
        }

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

        query = query
          .orderBy(`skills.${orderBy}`, order)
          .orderBy("skills.id", order)
          .limit(limit + 1);

        const skills = await query.execute();

        const hasNextPage = skills.length > limit;
        if (hasNextPage) {
          skills.pop();
        }

        const nextCursor = hasNextPage && skills.length > 0 ? skills[skills.length - 1]?.id : null;

        ctx.logger.debug({ count: skills.length, hasNextPage }, "Skills searched");
        return { items: skills, nextCursor };
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
            ctx.logger.warn({ skillId: id }, "RLS violation on skill update");
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to update this skill",
            });
          }
          if (isUniqueViolation(error)) {
            ctx.logger.warn({ name: updateData.name }, "Skill name already exists");
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
          const result = await trx.deleteFrom("skills").where("id", "=", input.id).executeTakeFirst();

          if (result.numDeletedRows === BigInt(0)) {
            ctx.logger.warn({ skillId: input.id }, "Skill not found");
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Skill not found or you don't have permission to delete it",
            });
          }

          ctx.logger.info({ skillId: input.id }, "Skill deleted");
          return { success: true };
        } catch (error) {
          if (isRLSViolation(error)) {
            ctx.logger.warn({ skillId: input.id }, "RLS violation on skill delete");
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to delete this skill",
            });
          }
          throw error;
        }
      });
    }),

  principals: authorizedProcedure([Permissions.SkillReadAll, Permissions.SkillReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const accessList = await trx
          .selectFrom("skillAccess")
          .leftJoin("users", "skillAccess.userId", "users.id")
          .leftJoin("groups", "skillAccess.groupId", "groups.id")
          .select([
            "skillAccess.role",
            "skillAccess.userId",
            "users.username",
            "users.email",
            "skillAccess.groupId",
            "groups.name as groupname",
          ])
          .where("skillAccess.skillId", "=", input.id)
          .execute();

        const principals: Principal[] = accessList.map((access) => {
          if (access.userId && access.username && access.email) {
            return {
              id: access.userId,
              type: "user" as const,
              role: access.role,
              username: access.username,
              email: access.email,
            };
          }
          if (access.groupId && access.groupname) {
            return {
              id: access.groupId,
              type: "group" as const,
              role: access.role,
              groupname: access.groupname,
            };
          }
          throw new Error("Invalid access entry: neither user nor group");
        });

        ctx.logger.debug({ skillId: input.id, principalCount: principals.length }, "Skill principals retrieved");
        return principals;
      });
    }),

  grantAccess: authorizedProcedure([Permissions.SkillUpdateAll, Permissions.SkillUpdateOwn])
    .input(
      z.object({
        skillId: z.uuid(),
        principalId: z.uuid(),
        principalType: z.enum(["user", "group"]),
        role: z.enum(["editor", "user"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          await trx
            .insertInto("skillAccess")
            .values({
              skillId: input.skillId,
              userId: input.principalType === "user" ? input.principalId : null,
              groupId: input.principalType === "group" ? input.principalId : null,
              role: input.role,
            })
            .onConflict((oc) => oc.doNothing())
            .execute();

          ctx.logger.info(
            {
              skillId: input.skillId,
              principalId: input.principalId,
              principalType: input.principalType,
              role: input.role,
            },
            "Skill access granted",
          );
          return { success: true };
        } catch (error) {
          if (isRLSViolation(error)) {
            ctx.logger.warn({ skillId: input.skillId }, "RLS violation on skill grant access");
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to grant access to this skill",
            });
          }
          throw error;
        }
      });
    }),

  revokeAccess: authorizedProcedure([Permissions.SkillUpdateAll, Permissions.SkillUpdateOwn])
    .input(
      z.object({
        skillId: z.uuid(),
        principalId: z.uuid(),
        principalType: z.enum(["user", "group"]),
        role: z.enum(["editor", "user"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          await trx
            .deleteFrom("skillAccess")
            .where("skillId", "=", input.skillId)
            .where(input.principalType === "user" ? "userId" : "groupId", "=", input.principalId)
            .where("role", "=", input.role)
            .execute();

          ctx.logger.info(
            {
              skillId: input.skillId,
              principalId: input.principalId,
              principalType: input.principalType,
              role: input.role,
            },
            "Skill access revoked",
          );
          return { success: true };
        } catch (error) {
          if (isRLSViolation(error)) {
            ctx.logger.warn({ skillId: input.skillId }, "RLS violation on skill revoke access");
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You don't have permission to revoke access from this skill",
            });
          }
          throw error;
        }
      });
    }),
});
