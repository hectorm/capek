export const SettingType = {
  String: "string",
  StringSecret: "string_secret",
  StringLarge: "string_large",
  StringList: "string_list",
  StringChoice: "string_choice",
  Number: "number",
  Boolean: "boolean",
  File: "file",
} as const;

export type SettingTypeValue = (typeof SettingType)[keyof typeof SettingType];
