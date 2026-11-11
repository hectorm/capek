import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";

import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import type { Database } from "#layers/core/shared/schema";
import type { ToolPart } from "#layers/core/shared/tools";
import { AI_CHART_TOOL, aiChartsToolProvider } from "#layers/ai/server/lib/charts";

const user = { id: crypto.randomUUID() } as AuthUser;

const chart = async (option: unknown, show?: (part: ToolPart) => void): Promise<string> => {
  const { tools } = await aiChartsToolProvider.load({} as Kysely<Database>, []);
  const tool = tools.find((candidate) => candidate.name === AI_CHART_TOOL);
  if (!tool) {
    throw new Error("Chart tool not found");
  }
  return tool.execute({ option }, { user, show });
};

describe("chart tool", () => {
  it("shows the chart of an option to the user", async () => {
    const option = {
      xAxis: { type: "category", data: ["a", "b"] },
      yAxis: {},
      series: [{ type: "bar", data: [1, 2] }],
    };
    const parts: ToolPart[] = [];

    expect(await chart(option, (part) => parts.push(part))).toBe("The chart was shown to the user");
    expect(parts).toEqual([{ type: "chart", option }]);

    // The points of the series can also come from a dataset
    const dataset = {
      dataset: { source: [["a", 1]] },
      xAxis: { type: "category" },
      yAxis: {},
      series: [{ type: "bar" }],
    };
    await chart(dataset, (part) => parts.push(part));
    expect(parts).toEqual([
      { type: "chart", option },
      { type: "chart", option: dataset },
    ]);
  });

  it("rejects an option that is not one of a chart or cannot be shown", async () => {
    const parts: ToolPart[] = [];
    const show = (part: ToolPart): void => {
      parts.push(part);
    };

    await expect(chart("{}", show)).rejects.toThrow("Missing required 'option' field");
    await expect(chart({ title: { text: "Notes" } }, show)).rejects.toThrow(/needs a 'series' array/);
    await expect(chart({ series: [] }, show)).rejects.toThrow(/needs a 'series' array/);
    await expect(chart({ series: [{ data: [1, 2] }] }, show)).rejects.toThrow(/needs a 'series' array/);
    await expect(chart({ series: [{ type: "bar" }] }, show)).rejects.toThrow(/needs its points in 'data'/);
    await expect(chart({ series: [{ type: "surface", data: [] }] }, show)).rejects.toThrow(/needs its points/);
    await expect(chart({ series: [{ type: "bar", data: [1, 2] }] })).rejects.toThrow("Charts cannot be shown here");

    expect(parts).toEqual([]);
  });
});
