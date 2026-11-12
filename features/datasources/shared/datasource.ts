import { z } from "zod/v4";

import { HttpRedactedValue } from "#layers/core/shared/http";

export const DatasourceAuthTypes = ["basic", "azure-service-principal", "azure-managed-identity", "none"] as const;
export type DatasourceAuthType = (typeof DatasourceAuthTypes)[number];

export const DatasourceConfigSchema = z.record(z.string(), z.unknown());
export type DatasourceConfig = z.infer<typeof DatasourceConfigSchema>;

// Type of datasource that users can connect to, like PostgreSQL
export interface DatasourceTypeDefinition<S extends z.ZodType = z.ZodType> {
  // Identifier stored with the datasources of the type
  type: string;
  label: string;
  // Example of the connection string
  placeholder: string;
  authTypes: readonly DatasourceAuthType[];
  configSchema: S;
  // Hides the secrets of a stored configuration
  redact: (config: DatasourceConfig) => DatasourceConfig;
  // Restores the secrets that were hidden in an incoming configuration from the stored one
  unredact: (incoming: DatasourceConfig, stored: DatasourceConfig) => DatasourceConfig;
}

export class DatasourceSecretsError extends Error {
  public constructor() {
    super("The hidden secrets have to be entered again to change the connection string");
    this.name = "DatasourceSecretsError";
  }
}

export const defineDatasourceType = <S extends z.ZodType>(def: {
  type: string;
  label: string;
  placeholder: string;
  authTypes: readonly DatasourceAuthType[];
  configSchema: S;
  redact: (parsed: z.infer<S>) => DatasourceConfig;
  unredact: (incoming: z.infer<S>, stored: z.infer<S> | undefined) => DatasourceConfig;
}): DatasourceTypeDefinition<S> => ({
  type: def.type,
  label: def.label,
  placeholder: def.placeholder,
  authTypes: def.authTypes,
  configSchema: def.configSchema,
  redact: (config) => {
    const parsedConfig = def.configSchema.safeParse(config);
    return parsedConfig.success ? def.redact(parsedConfig.data) : {};
  },
  unredact: (incoming, stored) => {
    const parsedIncoming = def.configSchema.parse(incoming);
    const parsedStored = def.configSchema.safeParse(stored);
    const config = def.unredact(parsedIncoming, parsedStored.success ? parsedStored.data : undefined);

    // Stored secrets are only taken while the connection string stays the same, or editors could send them elsewhere
    const taken = Object.entries(config).some(
      ([key, value]) => Boolean(value) && value !== (parsedIncoming as DatasourceConfig)[key],
    );
    if (taken && config.connectionString !== stored.connectionString) {
      throw new DatasourceSecretsError();
    }
    return config;
  },
});

const ConnectionUrlSchema = z.url().refine((value) => !URL.parse(value)?.password, {
  message: "The password of the connection string has to be entered in its own field",
});

// Configuration of the datasources that connect to a URL, with or without a user and password
export const UrlDatasourceConfigSchema = z.discriminatedUnion("authType", [
  z.object({
    connectionString: ConnectionUrlSchema,
    authType: z.literal("basic"),
    username: z.string().max(1000).trim().default(""),
    password: z.string().max(1000).default(""),
  }),
  z.object({
    connectionString: ConnectionUrlSchema,
    authType: z.literal("none"),
  }),
]);

export type UrlDatasourceConfig = z.infer<typeof UrlDatasourceConfigSchema>;

export const defineUrlDatasourceType = (def: {
  type: string;
  label: string;
  placeholder: string;
}): DatasourceTypeDefinition<typeof UrlDatasourceConfigSchema> => {
  return defineDatasourceType({
    ...def,
    authTypes: ["basic", "none"],
    configSchema: UrlDatasourceConfigSchema,
    redact: (parsed) => (parsed.authType === "basic" ? { ...parsed, password: HttpRedactedValue } : parsed),
    unredact: (incoming, stored) => {
      if (incoming.authType !== "basic" || incoming.password !== HttpRedactedValue) {
        return incoming;
      }
      return { ...incoming, password: stored?.authType === "basic" ? stored.password : "" };
    },
  });
};
