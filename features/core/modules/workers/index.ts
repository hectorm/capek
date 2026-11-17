import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { defineNuxtModule } from "nuxt/kit";
import ts from "typescript";

interface BundlerContext {
  addWatchFile: (file: string) => void;
  emitFile: (file: { type: "asset"; fileName: string; source: string }) => string;
  resolve: (source: string, importer: string) => Promise<unknown>;
}

// Bundling a worker with the server can start another server inside the worker
export default defineNuxtModule({
  meta: {
    name: "workers",
  },
  setup(_options, nuxt) {
    const featuresDir = join(nuxt.options.rootDir, "features");

    const workerThreadsPlugin = {
      name: "worker-threads-plugin",
      async transform(this: BundlerContext, code: string, id: string): Promise<{ code: string; map: null } | null> {
        const emitted = new Set<string>();
        const packages: { name: string; importer: string }[] = [];

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
            } else if (!imported.startsWith("node:")) {
              packages.push({ name: imported, importer: path });
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

        for (const { name, importer } of packages) {
          if (!(await this.resolve(name, importer))) {
            throw new Error(`"${importer}" imports "${name}", which cannot be resolved`);
          }
        }

        return pointed === code ? null : { code: pointed, map: null };
      },
    };

    nuxt.hook("nitro:config", (config) => {
      config.rollupConfig = { ...config.rollupConfig, plugins: [workerThreadsPlugin, config.rollupConfig?.plugins] };
    });
  },
});
