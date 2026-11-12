import type { UrlDatasourceConfig } from "#layers/datasources/shared/datasource";

export const connectionUrl = (config: UrlDatasourceConfig, options: ReadonlySet<string>): URL => {
  const url = new URL(config.connectionString);
  const unsupported = [...url.searchParams.keys()].find((name) => !options.has(name));
  if (unsupported) {
    throw new Error(`The option "${unsupported}" of the connection string is not supported`);
  }
  if (config.authType === "basic") {
    url.username = encodeURIComponent(config.username);
    url.password = encodeURIComponent(config.password);
  }
  return url;
};
