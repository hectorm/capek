import DOMPurify from "dompurify";

const purify = DOMPurify();

if (purify.isSupported) {
  purify.addHook("afterSanitizeAttributes", (node) => {
    if ("target" in node) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (!node.getAttribute("src")?.startsWith("data:")) {
      node.removeAttribute("src");
    }
  });
}

export const sanitizeHtml = (html: string): string => {
  if (!purify.isSupported) {
    throw new Error("HTML can only be sanitized in the browser");
  }

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
