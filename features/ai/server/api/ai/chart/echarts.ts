import { createError, defineEventHandler, setResponseHeaders } from "h3";
import { useStorage } from "nitropack/runtime/storage";

export default defineEventHandler(async (event) => {
  const libraries = await Promise.all([
    useStorage("assets:echarts").getItemRaw<string>("echarts.min.js"),
    useStorage("assets:echarts-gl").getItemRaw<string>("echarts-gl.min.js"),
  ]);
  if (!libraries.every(Boolean)) {
    throw createError({
      statusCode: 500,
      message: "ECharts is not available",
    });
  }

  setResponseHeaders(event, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });

  return libraries.join("\n");
});
