import { z } from "zod/v4";

// What a tool shows the user, apart from the result that it returns to its caller
export const ToolPartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("chart"),
    // Apache ECharts option of the chart
    option: z.record(z.string(), z.unknown()),
  }),
]);

export type ToolPart = z.infer<typeof ToolPartSchema>;
