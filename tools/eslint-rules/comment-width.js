const DIRECTIVE = /^\s*(?:eslint|prettier-ignore|@ts-|global |istanbul |c8 |#region|#endregion)/;
const PARAGRAPH_START = /^(?:$|[-*+] |\d+[.)] |[=\-#*_]{3,}|@\w|\w[\w ]*:(?: |$)|```)/;

export default {
  meta: {
    type: "layout",
    schema: [{ type: "object", properties: { maxLength: { type: "integer" } }, additionalProperties: false }],
    messages: {
      long: "Comment line longer than {{maxLength}} characters.",
      short: "Comment line can take the first word of the next line.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const maxLength = context.options[0]?.maxLength ?? 120;

    const toLine = (text, start, loc, own) => {
      const trimmed = text.trimEnd();
      return { text: trimmed, start, end: start + trimmed.length, loc, own };
    };

    const linesOf = (comment) => {
      if (comment.type === "Line") {
        const code = sourceCode.lines[comment.loc.start.line - 1].slice(0, comment.loc.start.column);
        const text = comment.value.replace(/^ /, "");
        const start = comment.loc.start.column + 2 + comment.value.length - text.length;
        return [toLine(text, start, comment.loc, code.trim() === "")];
      }
      return comment.value.split("\n").map((raw, i) => {
        const text = raw.replace(/^\s*\*? ?/, "");
        const start = (i === 0 ? comment.loc.start.column + 2 : 0) + raw.length - text.length;
        const line = comment.loc.start.line + i;
        return toLine(
          text,
          start,
          { start: { line, column: start }, end: { line, column: start + text.length } },
          true,
        );
      });
    };

    const check = (lines) => {
      lines.forEach((line, i) => {
        const words = line.text.split(/\s+/).filter(Boolean);
        if (line.end > maxLength && words.every((word) => line.start + word.length <= maxLength)) {
          context.report({ loc: line.loc, messageId: "long", data: { maxLength } });
        }
        const next = lines[i + 1];
        if (!next || !line.own || line.text.endsWith(":")) {
          return;
        }
        if (PARAGRAPH_START.test(line.text.trimStart()) || PARAGRAPH_START.test(next.text.trimStart())) {
          return;
        }
        const [firstWord = ""] = next.text.trimStart().split(/\s+/);
        if (line.end + 1 + firstWord.length <= maxLength) {
          context.report({ loc: line.loc, messageId: "short" });
        }
      });
    };

    return {
      Program() {
        let group = [];
        let previous = null;
        for (const comment of sourceCode.getAllComments()) {
          const lines = DIRECTIVE.test(comment.value) ? [] : linesOf(comment);
          const continues =
            comment.type === "Line" &&
            previous?.type === "Line" &&
            lines[0]?.own &&
            previous.loc.start.line === comment.loc.start.line - 1 &&
            previous.loc.start.column === comment.loc.start.column;
          if (!continues) {
            check(group);
            group = [];
          }
          group.push(...lines);
          previous = lines.length > 0 ? comment : null;
          if (comment.type === "Block") {
            check(group);
            group = [];
          }
        }
        check(group);
      },
    };
  },
};
