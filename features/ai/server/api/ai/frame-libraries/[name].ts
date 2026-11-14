import { version as echartsGlVersion } from "echarts-gl/package.json";
import { version as echartsVersion } from "echarts/package.json";
import { createError, defineEventHandler, getRouterParam, handleCacheHeaders, setResponseHeader } from "h3";
import { useStorage } from "nitropack/runtime/storage";

interface FrameLibrary {
  version: string;
  files: { storage: string; key: string }[];
}

const LIBRARIES = new Map<string, FrameLibrary>([
  [
    "echarts",
    {
      version: `${echartsVersion}-${echartsGlVersion}`,
      files: [
        { storage: "assets:echarts", key: "echarts.min.js" },
        { storage: "assets:echarts-gl", key: "echarts-gl.min.js" },
      ],
    },
  ],
]);

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, "name") ?? "";
  const library = LIBRARIES.get(name);
  if (!library) {
    throw createError({
      statusCode: 404,
      message: "Not Found",
    });
  }

  if (handleCacheHeaders(event, { etag: `"${library.version}"`, maxAge: 0 })) {
    return;
  }

  const sources = await Promise.all(
    library.files.map(({ storage, key }) => useStorage(storage).getItemRaw<string>(key)),
  );
  if (!sources.every(Boolean)) {
    throw createError({
      statusCode: 500,
      message: `The library "${name}" is not available`,
    });
  }

  setResponseHeader(event, "Content-Type", "text/javascript; charset=utf-8");

  return sources.join("\n");
});
