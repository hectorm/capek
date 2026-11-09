import { Marked } from "marked";

import { sanitizeHtml } from "#layers/ai/app/utils/sanitize-html";

const marked = new Marked({
  gfm: true,
  breaks: true,
});

export const mdToHtml = (md = ""): string => {
  return sanitizeHtml(marked.parse(md, { async: false }));
};
