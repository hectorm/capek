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
  return tool.execute({ name: "Notes", option }, { user, show });
};

describe("chart tool", () => {
  it("shows the chart of an option", async () => {
    const option = {
      xAxis: { type: "category", data: ["a", "b"] },
      yAxis: {},
      series: [{ type: "bar", data: [1, 2] }],
    };
    const parts: ToolPart[] = [];

    expect(await chart(option, (part) => parts.push(part))).toBe("The chart was shown to the user");
    expect(parts).toEqual([{ type: "chart", name: "Notes", option }]);

    const dataset = {
      dataset: { source: [["a", 1]] },
      xAxis: { type: "category" },
      yAxis: {},
      series: [{ type: "bar" }],
    };
    await chart(dataset, (part) => parts.push(part));
    expect(parts).toEqual([
      { type: "chart", name: "Notes", option },
      { type: "chart", name: "Notes", option: dataset },
    ]);
  });

  it("rejects an option that is not a valid chart", async () => {
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

  it("rejects an option that would not be drawn as written", async () => {
    const bars = { xAxis: { type: "category", data: ["a"] }, yAxis: {}, series: [{ type: "bar", data: [1] }] };
    const show = (): void => undefined;

    await expect(chart({ series: [{ type: "map", map: "world", data: [{ name: "Spain" }] }] }, show)).rejects.toThrow(
      /Maps cannot be drawn/,
    );
    await expect(chart({ ...bars, geo: { map: "world" } }, show)).rejects.toThrow(/Maps cannot be drawn/);
    await expect(chart({ ...bars, tooltip: { valueFormatter: "{value} €" } }, show)).rejects.toThrow(
      /'tooltip.valueFormatter' cannot be text, give Intl.NumberFormat options/,
    );
    await expect(
      chart({ ...bars, yAxis: { axisLabel: { formatter: "(value) => value / 1000" } } }, show),
    ).rejects.toThrow(/'yAxis.axisLabel.formatter' cannot be a function/);
    await expect(chart({ ...bars, tooltip: { formatter: "{b}: {@share}%" } }, show)).rejects.toThrow(
      /'tooltip.formatter' only has \{a\}/,
    );
    await expect(chart({ ...bars, tooltip: { valueFormatter: { style: "currency" } } }, show)).rejects.toThrow(
      /'tooltip.valueFormatter' is not a number format/,
    );
    await expect(chart({ ...bars, tooltip: { formatter: { style: "percent" } } }, show)).rejects.toThrow(
      /'tooltip.formatter' cannot be a number format, give it as the 'valueFormatter'/,
    );

    // Number formats, templates and the levels of a time axis are what a formatter can be
    const formatted = {
      ...bars,
      tooltip: { formatter: "{b}: {c}", valueFormatter: { style: "currency", currency: "EUR" } },
      xAxis: { type: "time", axisLabel: { formatter: { year: "{yyyy}", month: "{MMM}" } } },
      yAxis: { axisLabel: { formatter: { notation: "compact" } } },
      series: [{ type: "bar", data: [1], label: { formatter: "{b} => {@score}" } }],
    };
    expect(await chart(formatted, show)).toBe("The chart was shown to the user");
  });
});
