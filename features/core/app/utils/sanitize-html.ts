import type { Config } from "dompurify";
import DOMPurify from "dompurify";

const htmlConfig = {
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
} satisfies Config;

let sanitizer: ReturnType<typeof DOMPurify> | undefined;

const getSanitizer = (): ReturnType<typeof DOMPurify> => {
  if (sanitizer) {
    return sanitizer;
  }

  const purify = DOMPurify();
  if (!purify.isSupported) {
    throw new Error("HTML can only be sanitized in the browser");
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

  sanitizer = purify;
  return purify;
};

export function sanitizeHtml(html: string, options?: { returnFragment?: false }): string;
export function sanitizeHtml(html: string, options: { returnFragment: true }): DocumentFragment;
export function sanitizeHtml(html: string, options?: { returnFragment?: boolean }): string | DocumentFragment {
  const purify = getSanitizer();
  return options?.returnFragment
    ? purify.sanitize(html, { ...htmlConfig, RETURN_DOM_FRAGMENT: true })
    : purify.sanitize(html, htmlConfig);
}
