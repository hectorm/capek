import { defineToolProvider } from "#layers/core/server/lib/tools/define";

export const AI_CHART_TOOL = "ai_chart";

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const aiChartsToolProvider = defineToolProvider({
  name: "ai_charts",
  label: "ai.tools.charts.label",
  load() {
    return Promise.resolve({
      tools: [
        {
          name: AI_CHART_TOOL,
          description: "Show a chart to the user, drawn by Apache ECharts from its option.",
          parameters: {
            type: "object",
            properties: {
              option: {
                type: "object",
                description: "The Apache ECharts option of the chart",
              },
            },
            required: ["option"],
          },
          execute(args, context) {
            const { option } = args;
            if (!isObject(option)) {
              throw new Error("Missing required 'option' field");
            }

            const series: unknown[] = Array.isArray(option.series) ? option.series : [option.series];
            if (series.length === 0 || !series.every((item) => isObject(item) && typeof item.type === "string")) {
              throw new Error("The option needs a 'series' array whose items have a 'type'");
            }
            if (
              option.dataset === undefined &&
              !series.every((item) => isObject(item) && Array.isArray(item.data) && item.data.length > 0)
            ) {
              throw new Error("Each series needs its points in 'data', unless the option has a 'dataset'");
            }

            if (!context.show) {
              throw new Error("Charts cannot be shown here");
            }
            context.show({ type: "chart", option });

            return Promise.resolve("The chart was shown to the user");
          },
        },
      ],
      instructions: [
        "## Charts",
        "",
        `You can show charts to the user via the \`${AI_CHART_TOOL}\` tool, which takes an Apache ECharts option.`,
        "IMPORTANT:",
        '- The option is JSON, so it cannot have functions. Write formatters as string templates, like `"{b}: {c}"`.',
        "- Put the data in the option, aggregated to what the chart shows.",
        "- Give the chart a title and name its axes and series, in the same language the user is using.",
        "- Add a tooltip, and a legend when the chart has several series.",
        "- Charts in 3D are drawn by ECharts GL, like `bar3D`, `line3D`, `scatter3D` and `surface` on a `grid3D` with its `xAxis3D`, `yAxis3D` and `zAxis3D`. Compute the points of a surface, it cannot be given as an equation.",
        "- Do not set colors, backgrounds, fonts or sizes unless the user asks for them, the chart follows the theme of the application.",
        "- The user sees the chart where the tool is called, do not repeat it in your response as a table, an image or a link.",
      ].join("\n"),
    });
  },
});
