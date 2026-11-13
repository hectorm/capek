import type { TestResult } from "#layers/core/shared/types";
import type { DatasourceConnectionParams, ServerDatasourceType } from "#layers/datasources/server/lib/drivers";
import { useLogger } from "#layers/core/server/lib/logger";
import { findDatasourceType } from "#layers/datasources/server/lib/drivers";

const logger = useLogger();

export interface QuerySource extends DatasourceConnectionParams {
  id: string;
  type: string;
}

export const QUERY_MAX_ROWS = 100;

// Runs a query on a datasource and returns its first rows as JSON, telling whether it has more
export async function executeQuery(source: QuerySource, sql: string, signal?: AbortSignal): Promise<string> {
  const type = findDatasourceType(source.type);
  if (!type) {
    throw new Error(`Datasource type "${source.type}" is not supported`);
  }

  try {
    const rows = await type.driver.execute(source, sql, {
      maxRows: QUERY_MAX_ROWS + 1,
      maxBytes: 1_000_000,
      statementTimeoutMs: 30_000,
      requestTimeoutMs: 10_000,
      signal,
    });
    return JSON.stringify({ rows: rows.slice(0, QUERY_MAX_ROWS), truncated: rows.length > QUERY_MAX_ROWS });
  } catch (error) {
    logger.warn({ sourceId: source.id, error }, "Datasource query failed");
    throw error;
  }
}

export async function testConnection(
  type: ServerDatasourceType,
  params: DatasourceConnectionParams,
): Promise<TestResult> {
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
