import { defineToolProvider } from "#layers/core/server/lib/tools/define";
import { executeQuery } from "#layers/datasources/server/lib/query";
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
            "Execute a read-only SQL query on a datasource. Returns the resulting rows as JSON.",
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
            },
            required: ["datasource", "sql"],
          },
          async execute(args) {
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

            return executeQuery(source, args.sql);
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
