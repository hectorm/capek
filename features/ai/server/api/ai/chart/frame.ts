import { version as glVersion } from "echarts-gl/package.json";
import { version } from "echarts/package.json";
import { defineEventHandler, setResponseHeaders } from "h3";

import { composeCsp } from "#layers/core/server/lib/csp";

const page = (nonce: string): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body,
      #chart {
        height: 100%;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <div id="chart"></div>
    <script nonce="${nonce}" src="/api/ai/chart/echarts?v=${version}-${glVersion}"></script>
    <script nonce="${nonce}">
      let chart;
      let theme;
      let option;
      let flat;

      const draw = (message) => {
        theme = message.dark ? "dark" : null;
        option = message.option;
        document.documentElement.style.colorScheme = message.dark ? "dark" : "light";
        try {
          chart?.dispose();
          chart = echarts.init(document.getElementById("chart"), theme);
          chart.setOption({ ...option, backgroundColor: "transparent", animationDuration: 0 });
          // The dark theme has no colors for the axes in 3D
          if (theme && option.grid3D) {
            const lineStyle = { color: "#b7b9be" };
            chart.setOption({ grid3D: { axisLine: { lineStyle }, axisPointer: { lineStyle } } });
          }
          // Only what zrender draws on its own layers, which the charts in 3D do not use, has an SVG or more pixels
          flat = Object.values(chart.getZr().painter.getLayers()).every((layer) => layer.__builtin__);
          parent.postMessage({ type: "drawn", formats: flat ? ["png", "svg"] : ["png"] }, "*");
        } catch (error) {
          parent.postMessage({ type: "error", message: String(error) }, "*");
        }
      };

      const exportImage = (format) => {
        const background = theme ? "#18181b" : "#ffffff";
        if (format === "png") {
          const pixelRatio = flat ? 2 : chart.getDevicePixelRatio();
          return chart.getDataURL({ type: "png", pixelRatio, backgroundColor: background });
        }
        const size = { width: innerWidth, height: innerHeight };
        const svg = echarts.init(null, theme, { renderer: "svg", ssr: true, ...size });
        svg.setOption({ ...option, backgroundColor: background, animation: false });
        const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.renderToSVGString());
        svg.dispose();
        return url;
      };

      addEventListener("message", (event) => {
        if (event.source !== parent) return;
        if (event.data.type === "draw") {
          draw(event.data);
        } else if (event.data.type === "export" && chart) {
          parent.postMessage({ type: "export", url: exportImage(event.data.format) }, "*");
        }
      });
      addEventListener("resize", () => chart?.resize());
      parent.postMessage({ type: "ready" }, "*");
    </script>
  </body>
</html>
`;

export default defineEventHandler((event) => {
  const nonce = event.context.nonce;

  setResponseHeaders(event, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": composeCsp(
      {
        sandbox: ["allow-scripts"],
        "default-src": ["'none'"],
        "script-src": [`'nonce-${nonce}'`, "'unsafe-eval'"],
        "style-src": ["'unsafe-inline'"],
        "img-src": ["blob:", "data:"],
        "frame-ancestors": ["'self'"],
      },
      [],
    ),
  });

  return page(nonce);
});
