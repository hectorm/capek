import { z } from "zod/v4";

export const TablePartMaxRows = 5000;

export const ChartPartSchema = z.object({
  type: z.literal("chart"),
  name: z.string(),
  // Apache ECharts option of the chart
  option: z.record(z.string(), z.unknown()),
});

export type ChartPart = z.infer<typeof ChartPartSchema>;

export const TablePartSchema = z.object({
  type: z.literal("table"),
  name: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
});

export type TablePart = z.infer<typeof TablePartSchema>;

// What a tool shows the user, apart from the result that it returns to its caller
export const ToolPartSchema = z.discriminatedUnion("type", [ChartPartSchema, TablePartSchema]);

export type ToolPart = z.infer<typeof ToolPartSchema>;
