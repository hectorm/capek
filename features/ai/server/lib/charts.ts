import { defineToolProvider } from "#layers/core/server/lib/tools/define";

export const AI_CHART_TOOL = "ai_chart";

export const TIME_FORMATTER_LEVELS = ["year", "month", "day", "hour", "minute", "second", "millisecond", "none"];

const MAP_COMPONENTS = ["geo", "geo3D", "bmap"];
const MAP_SERIES = ["map", "map3D"];

const FUNCTION_PATTERN = /^\s*(function\b[^(]*\(|\([^)]*\)\s*=>|\w+\s*=>)/;

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isSeries = (value: unknown): value is Record<string, unknown> & { type: string } => {
  return isObject(value) && typeof value.type === "string";
};

const checkFormatter = (path: string, key: string, formatter: unknown, tooltip: boolean): void => {
  const isValueFormatter = key === "valueFormatter";

  if (isObject(formatter)) {
    if (TIME_FORMATTER_LEVELS.some((level) => level in formatter)) {
      return;
    }
    if (tooltip && !isValueFormatter) {
      throw new Error(`'${path}' cannot be a number format, give it as the 'valueFormatter' of the tooltip`);
    }
    try {
      new Intl.NumberFormat("en", formatter);
    } catch (error) {
      throw new Error(`'${path}' is not a number format: ${error instanceof Error ? error.message : ""}`);
    }
  } else if (typeof formatter === "string") {
    if (isValueFormatter) {
      throw new Error(`'${path}' cannot be text, give Intl.NumberFormat options like {"style": "percent"}`);
    }
    if (FUNCTION_PATTERN.test(formatter)) {
      throw new Error(
        `'${path}' cannot be a function, write a template or give Intl.NumberFormat options like {"style": "percent"}`,
      );
    }
    if (tooltip && formatter.includes("{@")) {
      throw new Error(
        `'${path}' only has {a}, {b}, {c}, {d} and {e}, format the values of the tooltip with 'valueFormatter'`,
      );
    }
  }
};

const checkFormatters = (value: unknown, path: string, parent: string): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      checkFormatters(item, `${path}[${String(index)}]`, parent);
    });
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = path ? `${path}.${key}` : key;
      if (key === "formatter" || key === "valueFormatter") {
        checkFormatter(itemPath, key, item, parent === "tooltip");
      } else {
        checkFormatters(item, itemPath, key);
      }
    }
  }
};

// The browser draws the chart after the tool has answered, so what it could not draw is told here
const checkOption = (option: Record<string, unknown>): void => {
  const series: unknown[] = Array.isArray(option.series) ? option.series : [option.series];
  if (series.length === 0 || !series.every(isSeries)) {
    throw new Error("The option needs a 'series' array whose items have a 'type'");
  }
  if (option.dataset === undefined && !series.every((item) => Array.isArray(item.data) && item.data.length > 0)) {
    throw new Error("Each series needs its points in 'data', unless the option has a 'dataset'");
  }
  if (
    MAP_COMPONENTS.some((component) => component in option) ||
    series.some((item) => MAP_SERIES.includes(item.type))
  ) {
    throw new Error("Maps cannot be drawn, show the data with another chart");
  }
  checkFormatters(option, "", "");
};

export const aiChartsToolProvider = defineToolProvider({
  name: "ai_charts",
  label: "ai.tools.charts.label",
  description: "ai.tools.charts.description",
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

            checkOption(option);

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
        "- Put the data in the option, aggregated to what the chart shows.",
        "- Give the chart a title and name its axes and series, in the same language the user is using.",
        "- Add a tooltip, and a legend when the chart has several series.",
        "- Do not set colors, backgrounds, fonts or sizes unless the user asks for them, the chart follows the theme of the application.",
        '- The option is JSON, so it cannot have functions. Where ECharts takes a formatter function, write a string template like `"{b}: {c}"`, or give `Intl.NumberFormat` options to format a number, like `"formatter": {"notation": "compact"}` in the labels of an axis or of a series.',
        '- In a tooltip, format the values with `"valueFormatter": {"style": "currency", "currency": "EUR"}` and leave its `formatter` out: a template there only has `{a}`, `{b}`, `{c}`, `{d}` and `{e}`, and shows the values as they are.',
        "- Keep `series` at the top level of the option, also with a `timeline`, whose `options` go beside it.",
        "- Maps cannot be drawn, there is no `map` series nor `geo` component.",
        "- Charts in 3D are drawn by ECharts GL, like `bar3D`, `line3D`, `scatter3D` and `surface` on a `grid3D` with its `xAxis3D`, `yAxis3D` and `zAxis3D`. Compute the points of a surface, it cannot be given as an equation.",
        "- The user sees the chart where the tool is called, so call it once for each chart and do not repeat the chart in your response as a table, an image or a link.",
      ].join("\n"),
    });
  },
});
