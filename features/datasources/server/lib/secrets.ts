import type { DatasourceConfig } from "#layers/datasources/shared/datasource";
import { useSecrets } from "#layers/core/server/lib/secrets";

const SOURCE_CONFIG_CONTEXT = "datasources_sources.config";

export const encryptSourceConfig = (config: DatasourceConfig): string => {
  return useSecrets().encrypt(JSON.stringify(config), SOURCE_CONFIG_CONTEXT);
};

export const decryptSourceConfig = (config: string): DatasourceConfig => {
  return JSON.parse(useSecrets().decrypt(config, SOURCE_CONFIG_CONTEXT)) as DatasourceConfig;
};
