import { Marked } from "marked";

import { sanitizeHtml } from "#layers/ai/app/utils/sanitize-html";

const marked = new Marked({
  gfm: true,
  breaks: true,
});

export const mdToHtml = (md = ""): string => {
  return sanitizeHtml(marked.parse(md, { async: false }));
};

export const mdToBlocks = (md = ""): string[] => {
  const tokens = marked.lexer(md);
  if (tokens.some((token) => token.type === "html" || token.type === "def")) {
    return [md];
  }
  return tokens.filter((token) => token.type !== "space").map((token) => token.raw);
};
