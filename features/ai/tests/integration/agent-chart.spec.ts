import { expect, test } from "@playwright/test";

import { answer, startChat } from "./chat";

test.describe("agent chart", () => {
  test("shows the chart of a tool call", async ({ page }) => {
    await startChat(page, "Mock specialist chart agent", "Show me a chart and end slowly.");

    const frame = answer(page, "This is a mock response").locator("iframe");
    const chart = frame.contentFrame().locator("canvas");
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    await expect(chart).toBeVisible();

    // The chart drawn while the answer is streamed is not drawn again when it ends
    const stop = page.getByRole("button", { name: /stop generating/i });
    await expect(stop).toBeVisible();
    await chart.evaluate((canvas) => {
      canvas.setAttribute("data-drawn", "once");
    });
    await expect(stop).toBeHidden();
    await page.waitForLoadState("networkidle");
    await expect(chart).toHaveAttribute("data-drawn", "once");

    await page.reload();
    await expect(page.locator("article iframe").contentFrame().locator("canvas")).toBeVisible();
    for (const format of ["png", "svg"]) {
      await page.locator("article iframe").hover();
      await page.getByRole("button", { name: /download/i }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitem", { name: `${format} image` }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(`mock-chart.${format}`);
    }
  });

  test("shows a chart in 3D", async ({ page }) => {
    await page.goto("/");
    const webgl = await page.evaluate(() => document.createElement("canvas").getContext("webgl") !== null);
    test.skip(!webgl, "WebGL is not available");

    await startChat(page, "Mock specialist chart agent", "Show me a chart in 3D.");

    const frame = answer(page, "This is a mock response").locator("iframe");
    await expect(frame.contentFrame().locator("canvas")).toBeVisible();

    // A chart in 3D is drawn with WebGL, which has no SVG export
    await frame.hover();
    await page.getByRole("button", { name: /download/i }).click();
    await expect(page.getByRole("menuitem", { name: "png image" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "svg image" })).toHaveCount(0);
  });
});
