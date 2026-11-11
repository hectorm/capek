import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { defineNuxtModule } from "nuxt/kit";
import ts from "typescript";

interface BundlerContext {
  addWatchFile(file: string): void;
  emitFile(file: { type: "asset"; fileName: string; source: string }): string;
}

// Emits the worker threads of the server as they are, since bundling them could start another server in the thread
export default defineNuxtModule({
  meta: {
    name: "workers",
  },
  setup(_options, nuxt) {
    const featuresDir = join(nuxt.options.rootDir, "features");

    const workerThreadsPlugin = {
      name: "worker-threads-plugin",
      transform(this: BundlerContext, code: string, id: string): { code: string; map: null } | null {
        const emitted = new Set<string>();

        const emit = (path: string): string => {
          const fileName = `workers/${relative(featuresDir, path)}`;
          if (emitted.has(path)) {
            return fileName;
          }
          emitted.add(path);

          const source = readFileSync(path, "utf8");
          const { outputText } = ts.transpileModule(source, {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ESNext,
              verbatimModuleSyntax: true,
            },
          });
          for (const { fileName: imported } of ts.preProcessFile(outputText, true, true).importedFiles) {
            if (/^\.\/[\w.-]+\.ts$/.test(imported)) {
              emit(resolve(dirname(path), imported));
            } else if (!/^(node:|@?[a-z])/.test(imported)) {
              throw new Error(`"${path}" runs in a worker thread, where "${imported}" cannot be imported`);
            }
          }

          this.addWatchFile(path);
          this.emitFile({ type: "asset", fileName, source });
          return fileName;
        };

        const pointed = code.replaceAll(
          /(new URL\(\s*["'])(\.\/[\w.-]+\.worker\.ts)(["'])/g,
          (_match, start: string, worker: string, end: string) => {
            return `${start}./${emit(resolve(dirname(id), worker))}${end}`;
          },
        );
        return pointed === code ? null : { code: pointed, map: null };
      },
    };

    nuxt.hook("nitro:config", (config) => {
      config.rollupConfig = { ...config.rollupConfig, plugins: [workerThreadsPlugin, config.rollupConfig?.plugins] };
    });
  },
});
