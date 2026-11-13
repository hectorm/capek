export const runtimeConfig: Record<string, unknown> = {
  databaseUrl: "memory://",
  databaseMaxConnections: 1,
  encryption: { key: "GIMAxGqsofiyEBw2fzuXw0IiTiDD5vKWDJzYS5FxCyM=", previousKey: "" },
  logLevel: "silent",
};

export const useRuntimeConfig = () => runtimeConfig;
