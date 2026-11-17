import type { TestResult } from "#layers/core/shared/types";
import type {
  DatasourceConnectionParams,
  DatasourceQuerySettings,
  ServerDatasourceType,
} from "#layers/datasources/server/lib/drivers";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

const VALIDATION_PHASE_TIMEOUT_MS = 5_000;

// Runs a statement on a datasource within the time to connect and run it
export const executeQuery = async (
  type: ServerDatasourceType,
  params: DatasourceConnectionParams,
  sql: string,
  settings: DatasourceQuerySettings,
): Promise<Record<string, unknown>[]> => {
  const deadline = settings.requestTimeoutMs
    ? AbortSignal.timeout(settings.requestTimeoutMs + (settings.statementTimeoutMs ?? 0))
    : undefined;
  const signal = AbortSignal.any([settings.signal, deadline].filter((s) => s !== undefined));
  try {
    return await type.driver.execute(params, sql, { ...settings, signal });
  } catch (error) {
    if (deadline?.aborted && !settings.signal?.aborted) {
      throw new Error("The query took longer than the time it is allowed to run", { cause: error });
    }
    throw error;
  }
};

// Runs the validation query of a datasource
export const testConnection = async (
  type: ServerDatasourceType,
  params: DatasourceConnectionParams,
): Promise<TestResult> => {
  try {
    await executeQuery(type, params, type.driver.validationQuery, {
      statementTimeoutMs: VALIDATION_PHASE_TIMEOUT_MS,
      requestTimeoutMs: VALIDATION_PHASE_TIMEOUT_MS,
    });
    logger.debug({ type: type.definition.type }, "Datasource test succeeded");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ type: type.definition.type, error: message }, "Datasource test failed");
    return { success: false, error: message };
  }
};
