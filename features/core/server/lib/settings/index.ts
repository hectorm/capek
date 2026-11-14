import type { SettingDefinition, SettingKey, SettingValueMap } from "#layers/core/server/lib/settings/define";
import { useDb } from "#layers/core/server/lib/database";
import { getServerFeatures } from "#layers/core/server/lib/features";
import { assertFeaturePrefix } from "#layers/core/server/lib/features/define";
import { useSecrets } from "#layers/core/server/lib/secrets";
import { SettingType } from "#layers/core/shared/settings";

const settingsCache = new Map<string, { value: unknown; expiresAt: number }>();
// Low enough to not have to deal with invalidation, high enough to not hammer the DB on bursts
const SETTINGS_CACHE_TTL_MS = 1000;

// Setting definition along with the name of the feature that defines it
export type FeatureSettingDefinition = SettingDefinition & { feature: string };

let settingDefinitions: Readonly<Record<string, FeatureSettingDefinition>> | null = null;

export const useSettingDefinitions = (): Readonly<Record<string, FeatureSettingDefinition>> => {
  if (!settingDefinitions) {
    const definitions: Record<string, FeatureSettingDefinition> = {};
    for (const feature of getServerFeatures()) {
      for (const [key, definition] of Object.entries(feature.settings ?? {})) {
        if (key in definitions) {
          throw new Error(`Duplicate setting "${key}" in feature "${feature.name}"`);
        }
        assertFeaturePrefix(feature.name, key, "Setting", ".");
        definitions[key] = { ...definition, feature: feature.name };
      }
    }
    settingDefinitions = definitions;
  }
  return settingDefinitions;
};

const secretContext = (key: string): string => `settings.value.${key}`;

export const encodeSettingValue = <V>(key: string, value: V): V | string => {
  return typeof value === "string" && useSettingDefinitions()[key]?.type === SettingType.StringSecret
    ? useSecrets().encrypt(value, secretContext(key))
    : value;
};

export const getSetting = async <K extends SettingKey>(key: K): Promise<SettingValueMap[K]> => {
  const now = Date.now();
  const cached = settingsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as SettingValueMap[K];
  }

  const definition = useSettingDefinitions()[key];
  if (!definition) {
    throw new Error(`Unknown setting "${key}"`);
  }

  const db = await useDb();
  const setting = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();

  let rawValue = setting?.value ?? definition.getDefault();
  if (typeof setting?.value === "string" && definition.type === SettingType.StringSecret) {
    rawValue = useSecrets().decrypt(setting.value, secretContext(key));
  }
  const value = definition.schema.parse(rawValue);

  settingsCache.set(key, { value, expiresAt: now + SETTINGS_CACHE_TTL_MS });

  return value as SettingValueMap[K];
};
