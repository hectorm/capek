import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

let purify: ReturnType<typeof DOMPurify>;

if (import.meta.server) {
  const { window } = new JSDOM("<!DOCTYPE html>");
  purify = DOMPurify(window);
} else {
  purify = DOMPurify();
}

purify.addHook("afterSanitizeAttributes", (node) => {
  if ("target" in node) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

export const sanitizeHtml = (html: string): string => {
  return purify.sanitize(html);
};
