import { z } from "zod/v4";

import { defineSeed, seedAccessSchema } from "#layers/core/server/lib/seed";
import { findDatasourceType } from "#layers/datasources/server/lib/drivers";
import { SourceResource } from "#layers/datasources/server/lib/resources";
import { DatasourceConfigSchema } from "#layers/datasources/shared/datasource";

const seedSourceSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(1000).trim().default(""),
  documentation: z.string().max(100000).trim().optional(),
  type: z.string().min(1).max(100),
  config: DatasourceConfigSchema,
  access: seedAccessSchema,
});

export const datasourcesSeed = defineSeed({
  schema: {
    sources: z.array(seedSourceSchema).max(1000).default([]),
  },
  async run(config, { db, logger, grantAccess }) {
    // Seed datasources (idempotent by name)
    for (const sourceConfig of config.sources) {
      const existing = await db
        .selectFrom("datasourcesSources")
        .where("name", "=", sourceConfig.name)
        .select("id")
        .executeTakeFirst();

      if (existing) {
        logger.info(`Datasource "${sourceConfig.name}" already exists, skipping`);
        continue;
      }

      const type = findDatasourceType(sourceConfig.type);
      if (!type) {
        throw new Error(`Datasource type "${sourceConfig.type}" of "${sourceConfig.name}" is not supported`);
      }

      const source = await db
        .insertInto("datasourcesSources")
        .values({
          name: sourceConfig.name,
          description: sourceConfig.description,
          documentation: sourceConfig.documentation ?? null,
          type: sourceConfig.type,
          config: JSON.stringify(type.definition.configSchema.parse(sourceConfig.config)),
        })
        .returning(["id", "name"])
        .executeTakeFirstOrThrow();

      logger.info(`Created datasource: ${source.name}`);

      await grantAccess(SourceResource, source.id, sourceConfig.access);
    }
  },
});
