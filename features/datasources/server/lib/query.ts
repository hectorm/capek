import type { DatasourceConnectionParams, ServerDatasourceType } from "#layers/datasources/server/lib/drivers";
import { useLogger } from "#layers/core/server/lib/logger";
import { findDatasourceType } from "#layers/datasources/server/lib/drivers";

const logger = useLogger();

export type TestConnectionResult = { success: true } | { success: false; error: string };

export interface QuerySource extends DatasourceConnectionParams {
  id: string;
  type: string;
}

// Runs a query on a datasource and returns its rows as JSON
export async function executeQuery(source: QuerySource, sql: string): Promise<string> {
  const type = findDatasourceType(source.type);
  if (!type) {
    throw new Error(`Datasource type "${source.type}" is not supported`);
  }

  try {
    const rows = await type.driver.execute(source, sql, {
      maxRows: 100,
      statementTimeoutMs: 30_000,
      requestTimeoutMs: 10_000,
    });
    return JSON.stringify(rows);
  } catch (error) {
    logger.warn({ sourceId: source.id, error }, "Datasource query failed");
    throw error;
  }
}

export async function testConnection(
  type: ServerDatasourceType,
  params: DatasourceConnectionParams,
): Promise<TestConnectionResult> {
  try {
    await type.driver.execute(params, type.driver.validationQuery, {
      statementTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    });
    logger.debug({ type: type.definition.type }, "Datasource test succeeded");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ type: type.definition.type, error: message }, "Datasource test failed");
    return { success: false, error: message };
  }
}
