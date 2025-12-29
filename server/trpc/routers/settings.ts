import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { SettingDefinition, SettingValueMap } from "~~/server/lib/settings";
import { canAny } from "~~/server/lib/authz/permissions";
import { withUserTransaction } from "~~/server/lib/database";
import { settingDefinitions } from "~~/server/lib/settings";
import { authorizedProcedure, createTRPCRouter } from "~~/server/trpc/init";
import { Permissions } from "~~/shared/rbac";
import { SettingType } from "~~/shared/settings";

type SettingsOutput = {
  [K in keyof typeof settingDefinitions]: (typeof settingDefinitions)[K] extends infer D
    ? D extends SettingDefinition
      ? Pick<D, "type" | "category" | "config"> & {
          value: SettingValueMap[K] | null;
          isOverridden: boolean;
        }
      : never
    : never;
};

export const settingsRouter = createTRPCRouter({
  list: authorizedProcedure([Permissions.SettingsListAll, Permissions.SettingsListPublic]).query(async ({ ctx }) => {
    return withUserTransaction(ctx.user, async (trx): Promise<Partial<SettingsOutput>> => {
      let allowedDefinitions;
      if (canAny(ctx.user, [Permissions.SettingsListAll])) {
        allowedDefinitions = Object.entries(settingDefinitions);
      } else if (canAny(ctx.user, [Permissions.SettingsListPublic])) {
        allowedDefinitions = Object.entries(settingDefinitions).filter(([, def]) => def.isPublic);
      } else {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to read settings.",
        });
      }

      const dbSettings = await trx
        .selectFrom("settings")
        .select(["key", "value"])
        .where(
          "key",
          "in",
          allowedDefinitions.map(([key]) => key),
        )
        .execute();
      const dbSettingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

      const settings = Object.fromEntries(
        allowedDefinitions.map(([key, definition]) => {
          const dbValue = dbSettingsMap.get(key);
          const isOverridden = dbValue != null;
          const isMasked = definition.type === SettingType.StringSecret || definition.type === SettingType.File;
          const value = isMasked ? null : (dbValue ?? definition.getDefault());

          return [
            key,
            {
              type: definition.type,
              category: definition.category,
              config: definition.config,
              value,
              isOverridden,
            },
          ];
        }),
      );

      ctx.logger.debug("Settings list retrieved");
      return settings;
    });
  }),

  upsert: authorizedProcedure([
    Permissions.SettingsCreate,
    Permissions.SettingsUpdateAll,
    Permissions.SettingsDeleteAll,
  ])
    .input(
      z
        .array(
          z.object({
            key: z.enum(Object.keys(settingDefinitions) as [string, ...string[]]),
            value: z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]).nullish(),
          }),
        )
        .max(100),
    )
    .mutation(async ({ ctx, input }) => {
      for (const item of input) {
        const definition = settingDefinitions[item.key as keyof typeof settingDefinitions];
        if (item.value != null) {
          try {
            definition.schema.parse(item.value);
          } catch (error) {
            ctx.logger.warn({ key: item.key, error }, "Setting validation failed");
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Invalid value for ${item.key}`,
            });
          }
        }
      }

      return withUserTransaction(ctx.user, async (trx) => {
        const itemsToDelete = input.filter((item) => item.value == null);
        const itemsToUpsert = input.filter((item) => item.value != null);

        if (itemsToDelete.length > 0) {
          await trx
            .deleteFrom("settings")
            .where(
              "key",
              "in",
              itemsToDelete.map((item) => item.key),
            )
            .execute();
        }

        if (itemsToUpsert.length > 0) {
          await trx
            .insertInto("settings")
            .values(
              itemsToUpsert.map((item) => ({
                key: item.key,
                value: JSON.stringify(item.value) as unknown as string,
                updatedAt: new Date(),
              })),
            )
            .onConflict((oc) =>
              oc.column("key").doUpdateSet((eb) => ({
                value: eb.ref("excluded.value"),
                updatedAt: eb.ref("excluded.updatedAt"),
              })),
            )
            .execute();
        }

        ctx.logger.info("Settings updated");
        return { success: true };
      });
    }),
});
