import type { UrlDatasourceConfig } from "#layers/datasources/shared/datasource";

export const connectionUrl = (config: UrlDatasourceConfig, options: ReadonlySet<string>): URL => {
  const url = new URL(config.connectionString);
  const unsupported = [...url.searchParams.keys()].find((name) => !options.has(name));
  if (unsupported !== undefined) {
    throw new Error(`The option "${unsupported}" of the connection string is not supported`);
  }
  if (config.authType === "basic") {
    url.username = encodeURIComponent(config.username);
    url.password = encodeURIComponent(config.password);
  }
  return url;
};

export const toRow = (names: readonly string[], values: readonly unknown[]): Record<string, unknown> => {
  const reserved = new Set(names);
  const used = new Set<string>();
  return Object.fromEntries(
    values.map((value, i) => {
      let name = names[i];
      if (!name || used.has(name)) {
        const base = `column${String(i + 1)}`;
        name = base;
        for (let suffix = 2; reserved.has(name) || used.has(name); suffix++) {
          name = `${base}_${String(suffix)}`;
        }
      }
      used.add(name);
      return [name, value];
    }),
  );
};
