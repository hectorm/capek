import type { z } from "zod/v4";

import type { coreSettings } from "#layers/core/server/settings";
import type { SettingType } from "#layers/core/shared/settings";
import type { UnionToIntersection } from "#layers/core/shared/types";

interface BaseSettingDefinition<V = unknown> {
  // Category used to group the setting in the settings page
  category: string;
  // Whether users without the `settings:*:all` permissions can read the setting
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

export const defineSetting = <V>(def: SettingDefinition<V>): SettingDefinition<V> => def;

// Setting definitions of each feature, registered through declaration merging
export interface SettingRegistry {
  core: typeof coreSettings;
}

export type SettingDefinitions = UnionToIntersection<SettingRegistry[keyof SettingRegistry]>;

export type SettingKey = Extract<keyof SettingDefinitions, string>;

export type SettingValueMap = {
  [K in SettingKey]: ReturnType<SettingDefinitions[K]["getDefault"]>;
};
