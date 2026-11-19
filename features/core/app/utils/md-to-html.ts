import { Marked } from "marked";

import { sanitizeHtml } from "#layers/core/app/utils/sanitize-html";

const marked = new Marked({ gfm: true });

interface MarkdownOptions {
  // Render single line breaks as <br>
  breaks?: boolean;
}

export const mdToHtml = (md = "", options: MarkdownOptions = {}): string => {
  return sanitizeHtml(marked.parse(md, { async: false, ...options }));
};

export const mdToFragment = (md = "", options: MarkdownOptions = {}): DocumentFragment => {
  return sanitizeHtml(marked.parse(md, { async: false, ...options }), { returnFragment: true });
};

export const mdToBlocks = (md = ""): string[] => {
  const tokens = marked.lexer(md);
  if (tokens.some((token) => token.type === "html" || token.type === "def")) {
    return [md];
  }
  return tokens.filter((token) => token.type !== "space").map((token) => token.raw);
};
