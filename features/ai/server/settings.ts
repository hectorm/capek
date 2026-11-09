import { useRuntimeConfig } from "nitropack/runtime/config";
import { z } from "zod/v4";

import { defineSetting } from "#layers/core/server/lib/settings/define";
import { SettingType } from "#layers/core/shared/settings";

export const aiSettings = {
  "ai.quickChats": defineSetting({
    type: SettingType.StringList,
    category: "welcome",
    isPublic: true,
    getDefault: (): string[] => {
      return useRuntimeConfig()
        .ai.quickChats.split(/(?<!\\);/)
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
} as const;

declare module "#layers/core/server/lib/settings/define" {
  interface SettingRegistry {
    ai: typeof aiSettings;
  }
}
