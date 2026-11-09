import { useRuntimeConfig } from "nitropack/runtime/config";
import { z } from "zod/v4";

import { defineSetting } from "#layers/core/server/lib/settings/define";
import { SettingType } from "#layers/core/shared/settings";

export const coreSettings = {
  "branding.name": defineSetting({
    type: SettingType.String,
    category: "branding",
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
    category: "branding",
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
    category: "branding",
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
    category: "branding",
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
    category: "branding",
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
    category: "branding",
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
