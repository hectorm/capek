import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type {
  SettingDefinition,
  SettingDefinitions,
  SettingKey,
  SettingValueMap,
} from "#layers/core/server/lib/settings/define";
import { canAny } from "#layers/core/server/lib/authz/permissions";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { encodeSettingValue, useSettingDefinitions } from "#layers/core/server/lib/settings";
import { authorizedProcedure, createTRPCRouter } from "#layers/core/server/trpc/init";
import { CorePermissions } from "#layers/core/shared/rbac";
import { SettingType } from "#layers/core/shared/settings";

type SettingsOutput = {
  [K in SettingKey]: SettingDefinitions[K] extends infer D
    ? D extends SettingDefinition
      ? Pick<D, "type" | "category" | "config"> & {
          // Feature whose messages hold the translations of the setting
          feature: string;
          value: SettingValueMap[K] | null;
          isOverridden: boolean;
        }
      : never
    : never;
};

export const settingsRouter = createTRPCRouter({
  list: authorizedProcedure([CorePermissions.SettingsListAll, CorePermissions.SettingsListPublic]).query(
    async ({ ctx }) => {
      return withUserTransaction(ctx.user, async (trx): Promise<Partial<SettingsOutput>> => {
        const settingDefinitions = Object.entries(useSettingDefinitions());
        const allowedDefinitions = canAny(ctx.user, [CorePermissions.SettingsListAll])
          ? settingDefinitions
          : settingDefinitions.filter(([, definition]) => definition.isPublic);

        const allowedKeys = allowedDefinitions.map(([key]) => key);
        if (allowedKeys.length === 0) {
          return {};
        }

        const dbSettings = await trx
          .selectFrom("settings")
          .select(["key", "value"])
          .where("key", "in", allowedKeys)
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
                feature: definition.feature,
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
    },
  ),

  update: authorizedProcedure([
    CorePermissions.SettingsCreate,
    CorePermissions.SettingsUpdateAll,
    CorePermissions.SettingsDeleteAll,
  ])
    .input(
      z.object({
        settings: z
          .array(
            z.object({
              key: z.string().refine((key) => Object.hasOwn(useSettingDefinitions(), key), "Unknown setting"),
              value: z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]).nullish(),
            }),
          )
          .max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      for (const item of input.settings) {
        const definition = useSettingDefinitions()[item.key];
        if (definition && item.value != null) {
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
        const itemsToDelete = input.settings.filter((item) => item.value == null);
        const itemsToUpsert = input.settings.filter((item) => item.value != null);

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
                value: JSON.stringify(encodeSettingValue(item.key, item.value)),
                updatedAt: new Date(),
              })),
            )
            .onConflict((oc) => {
              return oc.column("key").doUpdateSet((eb) => ({
                value: eb.ref("excluded.value"),
                updatedAt: eb.ref("excluded.updatedAt"),
              }));
            })
            .execute();
        }

        ctx.logger.info("Settings updated");
      });
    }),
});
