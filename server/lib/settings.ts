import { useRuntimeConfig } from "nitropack/runtime/config";
import { z } from "zod/v4";

import type { SettingCategoryValue } from "~~/shared/settings";
import { useDb } from "~~/server/lib/database";
import { SettingCategory, SettingType } from "~~/shared/settings";

const settingsCache = new Map<string, { value: unknown; expiresAt: number }>();
// Low enough to not have to deal with invalidation, high enough to not hammer the DB on bursts
const settingsCacheTtl = 1000;

interface BaseSettingDefinition<V = unknown> {
  category: SettingCategoryValue;
  isPublic: boolean;
  getDefault: () => V;
  schema: z.ZodType<V>;
}

export type SettingDefinition<V = unknown> =
  | (BaseSettingDefinition<V> & {
      type: typeof SettingType.String;
      config: {
        inputType: "text" | "email" | "url" | "tel";
        minLength: number;
        maxLength: number;
        pattern?: string;
      };
    })
  | (BaseSettingDefinition<V> & {
      type: typeof SettingType.StringSecret;
      config: {
        inputType: "password";
        minLength: number;
        maxLength: number;
        pattern?: string;
      };
    })
  | (BaseSettingDefinition<V> & {
      type: typeof SettingType.StringLarge;
      config: {
        minLength: number;
        maxLength: number;
      };
    })
  | (BaseSettingDefinition<V> & {
      type: typeof SettingType.StringList;
      config: {
        minItems: number;
        maxItems: number;
        itemMinLength: number;
        itemMaxLength: number;
        itemPattern?: string;
      };
    })
  | (BaseSettingDefinition<V> & {
      type: typeof SettingType.StringChoice;
      config: {
        options: {
          value: string;
          label?: string;
          icon?: string;
        }[];
      };
    })
  | (BaseSettingDefinition<V> & {
      type: typeof SettingType.Number;
      config: {
        min: number;
        max: number;
        step: number;
      };
    })
  | (BaseSettingDefinition<V> & {
      type: typeof SettingType.Boolean;
      config: Record<string, never>;
    })
  | (BaseSettingDefinition<V> & {
      type: typeof SettingType.File;
      config: {
        accept: string[];
        maxSize: number;
      };
    });

export type SettingValueMap = {
  [K in keyof typeof settingDefinitions]: ReturnType<(typeof settingDefinitions)[K]["getDefault"]>;
};

const defineSetting = <V>(def: SettingDefinition<V>): SettingDefinition<V> => def;

export const settingDefinitions = {
  "welcome.quickChats": defineSetting({
    type: SettingType.StringList,
    category: SettingCategory.Welcome,
    isPublic: true,
    getDefault: (): string[] => {
      return useRuntimeConfig()
        .welcome.quickChats.split(/(?<!\\);/)
        .map((item) => item.trim().replace(/\\;/g, ";"))
        .filter((item) => item.length > 0);
    },
    schema: z.array(z.string().min(1).max(255)).min(0).max(255),
    config: {
      minItems: 0,
      maxItems: 255,
      itemMinLength: 1,
      itemMaxLength: 255,
    },
  }),
  "branding.name": defineSetting({
    type: SettingType.String,
    category: SettingCategory.Branding,
    isPublic: true,
    getDefault: (): string => useRuntimeConfig().branding.name,
    schema: z.string().min(1).max(255),
    config: {
      inputType: "text",
      minLength: 1,
      maxLength: 255,
    },
  }),
  "branding.logo": defineSetting({
    type: SettingType.File,
    category: SettingCategory.Branding,
    isPublic: true,
    getDefault: (): string => useRuntimeConfig().branding.logo,
    schema: z
      .string()
      .min(0)
      .max((((128 * 1024) / 3) * 4) | 0), // Base64 overhead
    config: {
      accept: ["image/png", "image/webp", "image/jpeg", "image/jxl", "image/avif", "image/gif", "image/svg+xml"],
      maxSize: 128 * 1024,
    },
  }),
  "branding.icon": defineSetting({
    type: SettingType.File,
    category: SettingCategory.Branding,
    isPublic: true,
    getDefault: (): string => useRuntimeConfig().branding.icon,
    schema: z
      .string()
      .min(0)
      .max((((128 * 1024) / 3) * 4) | 0), // Base64 overhead
    config: {
      accept: ["image/png", "image/webp", "image/jpeg", "image/jxl", "image/avif", "image/gif", "image/svg+xml"],
      maxSize: 128 * 1024,
    },
  }),
  "branding.primaryColor": defineSetting({
    type: SettingType.StringChoice,
    category: SettingCategory.Branding,
    isPublic: true,
    getDefault: (): string => useRuntimeConfig().branding.primaryColor,
    schema: z.enum([
      "red",
      "orange",
      "amber",
      "yellow",
      "lime",
      "green",
      "emerald",
      "teal",
      "cyan",
      "sky",
      "blue",
      "indigo",
      "violet",
      "purple",
      "fuchsia",
      "pink",
      "rose",
    ]),
    config: {
      options: [
        { value: "red", label: "Red" },
        { value: "orange", label: "Orange" },
        { value: "amber", label: "Amber" },
        { value: "yellow", label: "Yellow" },
        { value: "lime", label: "Lime" },
        { value: "green", label: "Green" },
        { value: "emerald", label: "Emerald" },
        { value: "teal", label: "Teal" },
        { value: "cyan", label: "Cyan" },
        { value: "sky", label: "Sky" },
        { value: "blue", label: "Blue" },
        { value: "indigo", label: "Indigo" },
        { value: "violet", label: "Violet" },
        { value: "purple", label: "Purple" },
        { value: "fuchsia", label: "Fuchsia" },
        { value: "pink", label: "Pink" },
        { value: "rose", label: "Rose" },
      ],
    },
  }),
  "branding.neutralColor": defineSetting({
    type: SettingType.StringChoice,
    category: SettingCategory.Branding,
    isPublic: true,
    getDefault: (): string => useRuntimeConfig().branding.neutralColor,
    schema: z.enum(["slate", "gray", "zinc", "stone"]),
    config: {
      options: [
        { value: "slate", label: "Slate" },
        { value: "gray", label: "Gray" },
        { value: "zinc", label: "Zinc" },
        { value: "stone", label: "Stone" },
      ],
    },
  }),
  "branding.radius": defineSetting({
    type: SettingType.StringChoice,
    category: SettingCategory.Branding,
    isPublic: true,
    getDefault: (): string => useRuntimeConfig().branding.radius,
    schema: z.enum(["0", "0.125", "0.25", "0.375", "0.5"]),
    config: {
      options: [
        { value: "0", label: "0" },
        { value: "0.125", label: "0.125" },
        { value: "0.25", label: "0.25" },
        { value: "0.375", label: "0.375" },
        { value: "0.5", label: "0.5" },
      ],
    },
  }),
} as const;

export async function getSetting<K extends keyof SettingValueMap>(key: K): Promise<SettingValueMap[K]> {
  const now = Date.now();
  const cached = settingsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as SettingValueMap[K];
  }

  const db = await useDb();
  const setting = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();

  const rawValue = setting?.value ?? settingDefinitions[key].getDefault();
  const value = settingDefinitions[key].schema.parse(rawValue);

  settingsCache.set(key, { value, expiresAt: now + settingsCacheTtl });

  return value as SettingValueMap[K];
}
