import type { MCPConnection, MCPConnectionOptions } from "#layers/ai/server/lib/mcp/connection";
import type { TestResult } from "#layers/core/shared/types";
import { describeError } from "#layers/ai/server/lib/errors";
import { LegacyConnection } from "#layers/ai/server/lib/mcp/legacy";
import { ModernConnection } from "#layers/ai/server/lib/mcp/modern";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

export const connect = async (options: MCPConnectionOptions): Promise<MCPConnection> => {
  return (await ModernConnection.open(options)) ?? LegacyConnection.open(options);
};

export const testConnection = async (options: MCPConnectionOptions): Promise<TestResult> => {
  let connection: MCPConnection | undefined;
  try {
    connection = await connect(options);
    await connection.listTools();

    logger.debug({ serverName: options.name }, "MCP server test succeeded");
    return { success: true };
  } catch (error) {
    const message = describeError(error);
    logger.warn({ serverName: options.name, error: message }, "MCP server test failed");
    return { success: false, error: message };
  } finally {
    await connection?.close();
  }
};
