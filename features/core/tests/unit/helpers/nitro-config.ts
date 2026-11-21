export const runtimeConfig: Record<string, unknown> = {
  databaseUrl: "memory://",
  databaseMaxConnections: 1,
  encryption: { key: "GIMAxGqsofiyEBw2fzuXw0IiTiDD5vKWDJzYS5FxCyM=", previousKey: "" },
  allowedPrivateHosts: "",
  httpUserAgent: "test/1.0.0",
  logLevel: "silent",
};

export const useRuntimeConfig = (): Record<string, unknown> => runtimeConfig;
