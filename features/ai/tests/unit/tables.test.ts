import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import type { ToolPart } from "#layers/core/shared/tools";
import { compareCells, toCsv } from "#layers/ai/app/utils/table";
import { AI_TABLE_TOOL, aiTablesToolProvider } from "#layers/ai/server/lib/tables";

const user = { id: crypto.randomUUID() } as AuthUser;

const table = async (args: Record<string, unknown>, show?: (part: ToolPart) => void): Promise<string> => {
  const { tools } = await aiTablesToolProvider.load({} as Kysely<Database>, []);
  const tool = tools.find((candidate) => candidate.name === AI_TABLE_TOOL);
  if (!tool) {
    throw new Error("Table tool not found");
  }
  return tool.execute(args, { user, show });
};

describe("table tool", () => {
  it("shows the table of its columns and rows to the user", async () => {
    const columns = ["name", "total"];
    const rows = [
      ["a", 1],
      ["b", null],
    ];
    const name = "Totals";
    const parts: ToolPart[] = [];

    expect(await table({ name, columns, rows }, (part) => parts.push(part))).toBe("The table was shown to the user");
    expect(parts).toEqual([{ type: "table", name, columns, rows }]);

    await expect(table({ name, columns, rows: [["a", 1], ["b"]] })).rejects.toThrow(
      "Row 1 has to have a value for each of the 2 columns",
    );
    await expect(table({ name, columns: "name", rows })).rejects.toThrow("'columns' has to be an array of names");
    await expect(table({ columns, rows })).rejects.toThrow("Missing required 'name' field");
    await expect(table({ name, columns, rows })).rejects.toThrow("Tables cannot be shown here");
  });
});

describe("cells of a table", () => {
  it("are sorted by what they are, also the numbers and the dates given as text", () => {
    const sorted = (cells: unknown[]) => cells.toSorted(compareCells);

    expect(sorted(["10.5", "-3", 9, "3.10", "3.9", "1e3"])).toEqual(["-3", "3.10", "3.9", 9, "10.5", "1e3"]);
    expect(sorted(["9007199254740993", "-1", "9007199254740992"])).toEqual([
      "-1",
      "9007199254740992",
      "9007199254740993",
    ]);
    expect(sorted([true, false, true])).toEqual([false, true, true]);
    expect(
      sorted(["2025-01-02 10:06:11.5+00", "2025-01-02 10:06:11.312+00", "2025-01-02 10:06:11+00", "2024-12-31"]),
    ).toEqual(["2024-12-31", "2025-01-02 10:06:11+00", "2025-01-02 10:06:11.312+00", "2025-01-02 10:06:11.5+00"]);
    expect(sorted(["b10", "b9", "-4a", "-4", "-5", "B1"])).toEqual(["-5", "-4", "-4a", "B1", "b9", "b10"]);
  });
});

describe("CSV of a table", () => {
  it("quotes the values that need it and keeps spreadsheets from running them as formulas", () => {
    const rows = [
      ["a, b", 1],
      ['say "hi"', null],
      ["=1+1", -5],
      ["-2.50", "@sum"],
      [{ a: 1 }, true],
    ];

    expect(toCsv(["name", "total"], rows)).toBe(
      ["\uFEFFname,total", '"a, b",1', '"say ""hi""",', "'=1+1,-5", "-2.50,'@sum", '"{""a"":1}",true', ""].join("\r\n"),
    );
  });
});
