import type { DatasourceConnectionParams } from "#layers/datasources/server/lib/drivers";
import { defineToolProvider } from "#layers/ai/server/lib/tools/define";
import { TABLE_PART_MAX_ROWS } from "#layers/ai/shared/tools";
import { useLogger } from "#layers/core/server/lib/logger";
import { findDatasourceType } from "#layers/datasources/server/lib/drivers";
import { executeQuery } from "#layers/datasources/server/lib/query";
import { SourceResource } from "#layers/datasources/server/lib/resources";
import { decryptSourceConfig } from "#layers/datasources/server/lib/secrets";

interface QuerySource extends DatasourceConnectionParams {
  id: string;
  type: string;
}

const logger = useLogger();

export const DATASOURCES_QUERY_TOOL = "datasources_query";

const QUERY_MAX_ROWS = 100;
const QUERY_MAX_BYTES = 1_000_000;
const SHOWN_QUERY_MAX_BYTES = 5_000_000;

const QUERY_STATEMENT_TIMEOUT_MS = 30_000;
const QUERY_REQUEST_TIMEOUT_MS = 10_000;

// Runs a query on a datasource and returns its first rows
const querySource = async (
  source: QuerySource,
  sql: string,
  { shown, signal }: { shown: boolean; signal?: AbortSignal },
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> => {
  const type = findDatasourceType(source.type);
  if (!type) {
    throw new Error(`Datasource type "${source.type}" is not supported`);
  }

  const maxRows = shown ? TABLE_PART_MAX_ROWS : QUERY_MAX_ROWS;
  try {
    const rows = await executeQuery(type, source, sql, {
      maxRows: maxRows + 1,
      maxBytes: shown ? SHOWN_QUERY_MAX_BYTES : QUERY_MAX_BYTES,
      statementTimeoutMs: QUERY_STATEMENT_TIMEOUT_MS,
      requestTimeoutMs: QUERY_REQUEST_TIMEOUT_MS,
      signal,
    });
    return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
  } catch (error) {
    logger.warn({ sourceId: source.id, error }, "Datasource query failed");
    throw error;
  }
};

// Lets the agents that datasources are assigned to query them
export const datasourcesToolProvider = defineToolProvider({
  name: "datasources",
  label: "datasources.tools.label",
  resource: SourceResource,
  async load(db, resourceIds) {
    const stored = await db
      .selectFrom("datasourcesSources")
      .select(["id", "name", "documentation", "type", "config"])
      .where("id", "in", resourceIds)
      .orderBy("name", "asc")
      .execute();
    const sources = stored.map((source) => ({ ...source, config: decryptSourceConfig(source.config) }));

    if (sources.length === 0) {
      return { tools: [] };
    }

    return {
      tools: [
        {
          name: DATASOURCES_QUERY_TOOL,
          description: [
            "Execute a read-only SQL query on a datasource.",
            `Returns a JSON object with up to ${String(QUERY_MAX_ROWS)} \`rows\`, and \`truncated\` set when there are more.`,
            `With \`show\` and a \`name\`, up to ${String(TABLE_PART_MAX_ROWS)} rows are shown to the user as a table and only their number is returned as \`shown\`.`,
            "Available datasources:",
            ...sources.map((source) => `- "${source.name}" (${source.type})`),
          ].join("\n"),
          parameters: {
            type: "object",
            properties: {
              datasource: {
                type: "string",
                enum: sources.map((source) => source.name),
                description: "The datasource to query",
              },
              sql: {
                type: "string",
                description: "The SQL query to execute",
              },
              show: {
                type: "boolean",
                description: "Show the rows to the user as a table instead of returning them",
              },
              name: {
                type: "string",
                description: "The name of the table that is shown, which its file takes when the user downloads it",
              },
            },
            required: ["datasource", "sql"],
          },
          async execute(args, context) {
            if (typeof args.datasource !== "string") {
              throw new Error("Missing required 'datasource' field");
            }
            if (typeof args.sql !== "string") {
              throw new Error("Missing required 'sql' field");
            }

            const source = sources.find((candidate) => candidate.name === args.datasource);
            if (!source) {
              throw new Error(`Datasource "${args.datasource}" not found`);
            }

            if (args.show === true) {
              const { name } = args;
              if (typeof name !== "string" || !name.trim()) {
                throw new Error("Missing required 'name' field");
              }
              if (!context.show) {
                throw new Error("Tables cannot be shown here");
              }

              const { rows, truncated } = await querySource(source, args.sql, { shown: true, signal: context.signal });
              const [first] = rows;
              if (first) {
                context.show({
                  type: "table",
                  name,
                  columns: Object.keys(first),
                  rows: rows.map((row) => Object.values(row)),
                });
              }
              return JSON.stringify({ shown: rows.length, truncated });
            }

            return JSON.stringify(await querySource(source, args.sql, { shown: false, signal: context.signal }));
          },
          describe(args) {
            return typeof args.sql === "string" ? `\`\`\`sql\n${args.sql}\n\`\`\`` : undefined;
          },
        },
      ],
      instructions: [
        "## Datasources",
        "",
        `You have access to datasources via the \`${DATASOURCES_QUERY_TOOL}\` tool.`,
        "Use the schema and examples of each datasource to generate correct SQL for it.",
        "IMPORTANT:",
        "- Always call the tool to run queries, never include raw SQL in your response without executing it first.",
        `- You get at most ${String(QUERY_MAX_ROWS)} rows of a query, aggregate and filter in SQL rather than over those rows.`,
        `- To give rows to the user, run the query with \`show\` and a \`name\` for their table instead of writing them in your response, the user gets a table of up to ${String(TABLE_PART_MAX_ROWS)} rows to sort, filter and download as a file with that name.`,
        "- The user sees the table where the tool is called, so do not repeat its rows in your response.",
        "- Always respond in the same language the user is using.",
        "",
        "Available datasources:",
        ...sources.map((source) => `- "${source.name}" (${source.type})`),
      ].join("\n"),
      documents: Object.fromEntries(
        sources.flatMap((source) => (source.documentation ? [[`${source.name}.md`, source.documentation]] : [])),
      ),
    };
  },
});
