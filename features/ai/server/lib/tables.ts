import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { deflate, inflate } from "node:zlib";

import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { ChatTablePart } from "#layers/ai/shared/chat";
import type { NewChatTable } from "#layers/ai/shared/schema";
import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import type { TablePart } from "#layers/core/shared/tools";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { defineToolProvider } from "#layers/core/server/lib/tools/define";
import { TablePartMaxRows, TablePartSchema } from "#layers/core/shared/tools";

export const AI_TABLE_TOOL = "ai_table";

const PREVIEW_ROWS = 20;
const TABLE_MAX_CHARS = 5_000_000;
const SESSION_TABLES_MAX_CHARS = 50_000_000;

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

const tableData = new WeakMap<ChatTablePart, string>();

export const keepTable = ({ name, columns, rows }: TablePart): ChatTablePart => {
  if (rows.length > TablePartMaxRows) {
    throw new Error(`A table cannot have more than ${String(TablePartMaxRows)} rows, show fewer of them`);
  }

  const data = JSON.stringify({ columns, rows });
  if (data.length > TABLE_MAX_CHARS) {
    throw new Error(`A table cannot have more than ${String(TABLE_MAX_CHARS)} characters, show fewer rows or columns`);
  }

  const part: ChatTablePart = {
    type: "table",
    id: randomUUID(),
    name,
    columns,
    rows: rows.slice(0, PREVIEW_ROWS),
    rowCount: rows.length,
  };
  tableData.set(part, data);
  return part;
};

export const saveSessionTables = async (tables: ChatTablePart[], sessionId: string, user: AuthUser): Promise<void> => {
  const values: NewChatTable[] = [];
  for (const table of tables) {
    const data = tableData.get(table);
    if (data !== undefined) {
      values.push({ id: table.id, sessionId, data: await deflateAsync(data), size: data.length });
    }
  }
  if (values.length === 0) {
    return;
  }

  const size = values.reduce((total, value) => total + value.size, 0);

  await withUserTransaction(
    user,
    async (trx) => {
      const stored = await trx
        .selectFrom("aiChatTables")
        .select(sql<string>`COALESCE(SUM(size), 0)`.as("size"))
        .where("sessionId", "=", sessionId)
        .executeTakeFirstOrThrow();
      if (Number(stored.size) + size > SESSION_TABLES_MAX_CHARS) {
        throw new Error(
          `The tables of a chat cannot have more than ${String(SESSION_TABLES_MAX_CHARS)} characters in all, show fewer rows or columns`,
        );
      }

      await trx.insertInto("aiChatTables").values(values).execute();
    },
    { trustedWrites: true },
  );
};

export const attachTables = async (db: Kysely<Database>, tables: ChatTablePart[], messageId: string): Promise<void> => {
  if (tables.length === 0) {
    return;
  }

  const ids = tables.map((table) => table.id);
  await db.updateTable("aiChatTables").set({ messageId }).where("id", "in", ids).execute();
};

export const loadTable = async (id: string, user: AuthUser): Promise<string | undefined> => {
  const row = await withUserTransaction(user, (trx) => {
    return trx.selectFrom("aiChatTables").select(["data"]).where("id", "=", id).executeTakeFirst();
  });

  if (!row) {
    return undefined;
  }

  return (await inflateAsync(row.data)).toString("utf8");
};

export const aiTablesToolProvider = defineToolProvider({
  name: "ai_tables",
  label: "ai.tools.tables.label",
  description: "ai.tools.tables.description",
  load() {
    return Promise.resolve({
      tools: [
        {
          name: AI_TABLE_TOOL,
          description: "Show a table to the user, who can sort it, filter it and download it as CSV.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The name of the table, which its file takes when the user downloads it",
              },
              columns: {
                type: "array",
                items: { type: "string" },
                description: "The names of the columns",
              },
              rows: {
                type: "array",
                items: { type: "array" },
                description: "The rows, each one an array with the value of each column",
              },
            },
            required: ["name", "columns", "rows"],
          },
          execute(args, context) {
            if (typeof args.name !== "string" || !args.name.trim()) {
              throw new Error("Missing required 'name' field");
            }

            const table = TablePartSchema.safeParse({ ...args, type: "table" });
            if (!table.success || table.data.columns.length === 0) {
              throw new Error("'columns' has to be an array of names and 'rows' an array of arrays of values");
            }

            const { columns, rows } = table.data;
            const uneven = rows.findIndex((row) => row.length !== columns.length);
            if (uneven !== -1) {
              throw new Error(
                `Row ${String(uneven)} has to have a value for each of the ${String(columns.length)} columns`,
              );
            }

            if (!context.show) {
              throw new Error("Tables cannot be shown here");
            }
            context.show(table.data);

            return Promise.resolve("The table was shown to the user");
          },
        },
      ],
      instructions: [
        "## Tables",
        "",
        `You can show tables to the user via the \`${AI_TABLE_TOOL}\` tool, which takes the names of the columns and the rows.`,
        "IMPORTANT:",
        "- Use it for data with too many rows to write in your response, the user can sort, filter and download the table.",
        "- Give each row as an array with the value of each column, in the order of the columns.",
        "- Name the columns in the same language the user is using.",
        "- Name the table for what it has, also in that language, the user downloads it as a file with that name.",
        `- A table cannot have more than ${String(TablePartMaxRows)} rows.`,
        "- The user sees the table where the tool is called, so do not repeat its rows in your response.",
      ].join("\n"),
    });
  },
});
