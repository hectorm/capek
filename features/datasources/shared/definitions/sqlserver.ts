import { z } from "zod/v4";

import { HTTP_REDACTED_VALUE } from "#layers/core/shared/http";
import { defineDatasourceType } from "#layers/datasources/shared/datasource";

export const SqlServerDatasourceType = defineDatasourceType({
  type: "sqlserver",
  label: "SQL Server",
  placeholder: "Server=<host>,1433;Database=<database>;Encrypt=true",
  authTypes: ["basic", "azure-service-principal", "azure-managed-identity", "none"],
  configSchema: z.discriminatedUnion("authType", [
    z.object({
      connectionString: z.string().trim().min(1).max(4000),
      authType: z.literal("basic"),
      username: z.string().max(1000).trim().default(""),
      password: z.string().max(1000).default(""),
    }),
    z.object({
      connectionString: z.string().trim().min(1).max(4000),
      authType: z.literal("azure-service-principal"),
      azureTenantId: z.string().max(1000).trim().default(""),
      azureClientId: z.string().max(1000).trim().default(""),
      azureClientSecret: z.string().max(1000).default(""),
    }),
    z.object({
      connectionString: z.string().trim().min(1).max(4000),
      authType: z.literal("azure-managed-identity"),
      azureClientId: z.string().max(1000).trim().default(""),
    }),
    z.object({
      connectionString: z.string().trim().min(1).max(4000),
      authType: z.literal("none"),
    }),
  ]),
  redact: (p) => {
    switch (p.authType) {
      case "basic":
        return { ...p, password: HTTP_REDACTED_VALUE };
      case "azure-service-principal":
        return { ...p, azureClientSecret: HTTP_REDACTED_VALUE };
      case "azure-managed-identity":
      case "none":
        return p;
    }
  },
  unredact: (i, s) => {
    switch (i.authType) {
      case "basic":
        if (i.password !== HTTP_REDACTED_VALUE) {
          return i;
        }
        return { ...i, password: s?.authType === "basic" ? s.password : "" };
      case "azure-service-principal":
        if (i.azureClientSecret !== HTTP_REDACTED_VALUE) {
          return i;
        }
        return {
          ...i,
          azureClientSecret: s?.authType === "azure-service-principal" ? s.azureClientSecret : "",
        };
      case "azure-managed-identity":
      case "none":
        return i;
    }
  },
});
