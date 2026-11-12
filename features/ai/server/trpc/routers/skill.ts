import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { OpenAIFunctionParameters } from "#layers/ai/shared/openai";
import { SkillResource } from "#layers/ai/server/lib/resources";
import { parseSkillParameters, validateSkillJSDoc, validateSkillSyntax } from "#layers/ai/server/lib/skills/validator";
import { AiPermissions } from "#layers/ai/shared/rbac";
import { grantResourceAccess } from "#layers/core/server/lib/authz/resources";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { isRLSViolation, isUniqueViolation } from "#layers/core/server/lib/database/errors";
import { PageCursorSchema, paginate } from "#layers/core/server/lib/database/pagination";
import { sharedResourceAccessProcedures } from "#layers/core/server/trpc/access";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";

export const skillRouter = createTRPCRouter({
  read: authorizedProcedure([AiPermissions.SkillReadAll, AiPermissions.SkillReadOwn])
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        const skill = await trx
          .selectFrom("aiSkills")
          .select(["id", "name", "description", "documentation", "code"])
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

  search: authorizedProcedure([AiPermissions.SkillListAll, AiPermissions.SkillListOwn])
    .input(
      z.object({
        search: z.union([z.string().max(255), z.array(z.string().max(255)).max(255)]).optional(),
        searchBy: z.enum(["name", "description"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        orderBy: z.enum(["name", "description"]).default("name"),
        limit: z.number().min(1).max(100).default(50),
        cursor: PageCursorSchema.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor, limit, searchBy, search, orderBy, order } = input;

      return withUserTransaction(ctx.user, async (trx) => {
        let query = trx.selectFrom("aiSkills").select(["id", "name", "description"]);

        // Apply search filters
        if (search && (typeof search === "string" ? search.length > 0 : search.length > 0)) {
          const searchList = Array.isArray(search) ? search : [search];
          query = query.where((eb) => eb.or(searchList.map((v) => eb(`aiSkills.${searchBy}`, "ilike", `%${v}%`))));
        }

        const { rows: skills, nextCursor } = await paginate(query, {
          table: "aiSkills",
          orderBy,
          order,
          limit,
          cursor,
        });

        ctx.logger.debug("Skill list retrieved");
        return { skills, nextCursor };
      });
    }),

  create: authorizedProcedure([AiPermissions.SkillCreate])
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
        code: z
          .string()
          .max(100000)
          .transform((v) => v || null)
          .nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let parameters: OpenAIFunctionParameters = { type: "object", properties: {} };

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

        parameters = parseSkillParameters(input.code)?.parameters ?? parameters;
      }

      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const skillId = crypto.randomUUID();

          await trx
            .insertInto("aiSkills")
            .values({
              id: skillId,
              name: input.name,
              description: input.description,
              documentation: input.documentation ?? null,
              parameters: JSON.stringify(parameters),
              code: input.code ?? null,
            })
            .execute();

          await grantResourceAccess(trx, SkillResource, skillId, [
            { id: ctx.user.id, type: "user", role: "editor" },
            { id: ctx.user.id, type: "user", role: "user" },
          ]);

          const skill = await trx
            .selectFrom("aiSkills")
            .select(["id", "name", "description", "documentation", "code"])
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

  update: authorizedProcedure([AiPermissions.SkillUpdateAll, AiPermissions.SkillUpdateOwn])
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
            .updateTable("aiSkills")
            .set({
              updatedAt: new Date(),
              name: updateData.name,
              description: updateData.description,
              documentation: updateData.documentation,
              parameters: parsedParameters,
              code: updateData.code,
            })
            .where("id", "=", id)
            .returning(["id", "name", "description", "documentation", "code"])
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

  delete: authorizedProcedure([AiPermissions.SkillDeleteAll, AiPermissions.SkillDeleteOwn])
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withUserTransaction(ctx.user, async (trx) => {
        try {
          const deleted = await trx
            .deleteFrom("aiSkills")
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

  ...sharedResourceAccessProcedures({
    resource: SkillResource,
    idKey: "skillId",
    label: "skill",
    readPermissions: [AiPermissions.SkillReadAll, AiPermissions.SkillReadOwn],
    updatePermissions: [AiPermissions.SkillUpdateAll, AiPermissions.SkillUpdateOwn],
  }),
});
