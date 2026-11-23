import { expect, test } from "@playwright/test";

import { answer, startChat } from "#layers/ai/tests/integration/chat";
import { reloadPage } from "#layers/core/tests/integration/navigation";

test.describe("agent chart", () => {
  test("shows the chart of a tool call", async ({ page, request }) => {
    const prompt = `Show me a chart and end on release ${crypto.randomUUID()}.`;
    await startChat(page, "Mock specialist chart agent", prompt);

    const frame = answer(page, "This is a mock response").getByTitle("Chart", { exact: true });
    const chart = frame.contentFrame().locator("canvas");
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    await expect(chart).toBeVisible();

    // The chart drawn while the answer is streamed is not drawn again when it ends
    const stop = page.getByRole("button", { name: /stop generating/i });
    await expect(stop).toBeVisible();
    await chart.evaluate((canvas) => {
      canvas.setAttribute("data-drawn", "once");
    });
    const refreshed = page.waitForResponse("**/api/trpc/*ai.chatMessage.list*");
    expect((await request.post("http://localhost:51235/release", { data: prompt })).ok()).toBe(true);
    await expect(stop).toBeHidden();
    await refreshed;
    await expect(chart).toHaveAttribute("data-drawn", "once");

    await reloadPage(page);
    const reloaded = page.getByRole("article").getByTitle("Chart", { exact: true });
    await expect(reloaded.contentFrame().locator("canvas")).toBeVisible();
    for (const format of ["png", "svg"]) {
      await reloaded.hover();
      await page.getByRole("button", { name: /download/i }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitem", { name: `${format} image` }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(`mock-chart.${format}`);
    }
  });

  test("shows a chart in 3D", async ({ page }) => {
    const webgl = await page.evaluate(() => document.createElement("canvas").getContext("webgl") !== null);
    test.skip(!webgl, "WebGL is not available");

    await startChat(page, "Mock specialist chart agent", "Show me a chart in 3D.");

    const frame = answer(page, "This is a mock response").getByTitle("Chart", { exact: true });
    await expect(frame.contentFrame().locator("canvas")).toBeVisible();

    // A chart in 3D drawn with WebGL has no SVG export
    await frame.hover();
    await page.getByRole("button", { name: /download/i }).click();
    await expect(page.getByRole("menuitem", { name: "png image" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "svg image" })).toHaveCount(0);
  });
});
