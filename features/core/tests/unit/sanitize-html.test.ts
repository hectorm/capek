// @vitest-environment jsdom
import { expect, it } from "vitest";

import { sanitizeHtml } from "#layers/core/app/utils/sanitize-html";

it("sanitizes a fragment and then returns to string output", () => {
  const input = [
    '<p style="position: fixed">Documentation</p>',
    '<a href="https://example.com">Example</a>',
    '<img src="/example.png">',
  ].join("");
  const fragment = sanitizeHtml(input, { returnFragment: true });

  expect(fragment).toBeInstanceOf(DocumentFragment);
  expect(fragment.querySelector("p")?.textContent).toBe("Documentation");
  expect(fragment.querySelector("[style], img[src]")).toBeNull();
  expect(fragment.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
  expect(fragment.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  expect(sanitizeHtml(input)).toBeTypeOf("string");
});
