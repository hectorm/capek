import path from "node:path";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const ROUTE_PARAMETER = /^\[{1,2}(?:\.{3})?[A-Za-z0-9]+\]{1,2}$/;
const LOCALE_TAG = /^[a-z]{2,3}-[A-Z]{2}$/;
const MIGRATION_NAME = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/;

const fileStyle = (directories, name, extension) => {
  if (ROUTE_PARAMETER.test(name)) {
    return null;
  }
  if (extension === ".vue" && directories.includes("components")) {
    return PASCAL_CASE.test(name) ? null : "PascalCase";
  }
  if (directories.at(-1) === "locales" && LOCALE_TAG.test(name)) {
    return null;
  }
  if (directories.at(-1) === "migrations" && MIGRATION_NAME.test(name)) {
    return null;
  }
  return KEBAB_CASE.test(name) ? null : "kebab-case";
};

export default {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      file: 'File "{{name}}" has to be named in {{style}}.',
      directory: 'Directory "{{name}}" has to be named in kebab-case.',
    },
  },
  create(context) {
    return {
      Program(node) {
        const relative = path.relative(context.cwd, context.filename);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          return;
        }

        const directories = relative.split(path.sep);
        const file = directories.pop();
        const name = file.split(".")[0];

        for (const directory of directories) {
          if (!directory.startsWith(".") && !KEBAB_CASE.test(directory) && !ROUTE_PARAMETER.test(directory)) {
            context.report({ node, loc: node.loc.start, messageId: "directory", data: { name: directory } });
          }
        }

        const style = fileStyle(directories, name, path.extname(file));
        if (style) {
          context.report({ node, loc: node.loc.start, messageId: "file", data: { name: file, style } });
        }
      },
    };
  },
};
