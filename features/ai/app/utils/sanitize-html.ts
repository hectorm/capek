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
  if (!node.getAttribute("src")?.startsWith("data:")) {
    node.removeAttribute("src");
  }
});

export const sanitizeHtml = (html: string): string => {
  return purify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "dialog"],
    FORBID_ATTR: [
      "style",
      "class",
      "popover",
      "popovertarget",
      "popovertargetaction",
      "command",
      "commandfor",
      "srcset",
      "poster",
      "background",
    ],
  });
};
