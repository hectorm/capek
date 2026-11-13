export const runtimeConfig: Record<string, unknown> = {
  databaseUrl: "memory://",
  databaseMaxConnections: 1,
  logLevel: "silent",
};

export const useRuntimeConfig = () => runtimeConfig;
