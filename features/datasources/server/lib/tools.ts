import { defineToolProvider } from "#layers/core/server/lib/tools/define";
import { TablePartMaxRows } from "#layers/core/shared/tools";
import { executeQuery, QUERY_MAX_ROWS } from "#layers/datasources/server/lib/query";
import { SourceResource } from "#layers/datasources/server/lib/resources";

export const DATASOURCES_QUERY_TOOL = "datasources_query";

// Lets the callers that datasources are assigned to query them
export const datasourcesToolProvider = defineToolProvider({
  name: "datasources",
  label: "datasources.tools.label",
  resource: SourceResource,
  async load(db, resourceIds) {
    const sources = await db
      .selectFrom("datasourcesSources")
      .select(["id", "name", "documentation", "type", "config"])
      .where("id", "in", resourceIds)
      .orderBy("name", "asc")
      .execute();

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
            `With \`show\` and a \`name\`, up to ${String(TablePartMaxRows)} rows are shown to the user as a table and only their number is returned as \`shown\`.`,
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

              const { rows, truncated } = await executeQuery(source, args.sql, { shown: true, signal: context.signal });
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

            return JSON.stringify(await executeQuery(source, args.sql, { signal: context.signal }));
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
        `- To give rows to the user, run the query with \`show\` and a \`name\` for their table instead of writing them in your response, the user gets a table of up to ${String(TablePartMaxRows)} rows to sort, filter and download as a file with that name.`,
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
