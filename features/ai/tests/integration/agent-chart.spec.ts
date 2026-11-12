import { expect, test } from "@playwright/test";

test.describe("Agent Chart", () => {
  test("should show the chart of a tool call", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the app to be ready
    await page.waitForLoadState("networkidle");

    // Wait for the agent selector to load
    const agentSelector = page.getByRole("button", { name: /Select agent/i });
    await expect(agentSelector).toBeVisible({ timeout: 5000 });

    // Click the agent selector to open the dropdown
    await agentSelector.click();

    // Wait for the dropdown to appear and select the agent
    const agentOption = page.getByRole("option", { name: /Mock specialist chart agent/i });
    await expect(agentOption).toBeVisible({ timeout: 5000 });
    await agentOption.click();

    // Wait for the dropdown to close
    await expect(agentOption).not.toBeVisible({ timeout: 2000 });

    // Find the chat input textarea and type a message
    const chatPrompt = page.getByRole("textbox", { name: /message/i });
    await expect(chatPrompt).toBeVisible();
    await chatPrompt.fill("Show me a chart and end slowly.");

    // Submit the message using the send button
    const submitButton = page.getByRole("button", { name: /send prompt/i });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for navigation to the chat page
    await page.waitForURL(/\/chat\/.+/, { timeout: 5000 });

    // Wait for the answer, which calls the tool that shows a chart
    const assistantMessage = page.locator("article").filter({ hasText: "This is a mock response" });
    await expect(assistantMessage).toBeVisible({ timeout: 15000 });

    // Validate that the chart is drawn in a frame without access to the application
    const chartFrame = assistantMessage.locator("iframe");
    const chart = chartFrame.contentFrame().locator("canvas");
    await expect(chartFrame).toHaveAttribute("sandbox", "allow-scripts");
    await expect(chart).toBeVisible({ timeout: 15000 });

    // Validate that the chart drawn while the answer is streamed is not drawn again when it ends
    const stopButton = page.getByRole("button", { name: /stop generating/i });
    await expect(stopButton).toBeVisible();
    await chart.evaluate((canvas) => {
      canvas.setAttribute("data-drawn", "once");
    });
    await expect(stopButton).not.toBeVisible({ timeout: 15000 });
    await page.waitForLoadState("networkidle");
    await expect(chart).toHaveAttribute("data-drawn", "once");

    // Validate that the chart is kept with the answer
    await page.reload();
    await expect(page.locator("article iframe").contentFrame().locator("canvas")).toBeVisible({ timeout: 15000 });

    // Validate that the chart is downloaded as an image in each format
    for (const format of ["png", "svg"]) {
      await page.locator("article iframe").hover();
      await page.getByRole("button", { name: /download/i }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitem", { name: new RegExp(`${format} image`, "i") }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(`chart.${format}`);
    }
  });

  test("should show a chart in 3D", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the app to be ready
    await page.waitForLoadState("networkidle");

    // A chart in 3D needs WebGL, which not every browser has where the tests run
    const webgl = await page.evaluate(() => document.createElement("canvas").getContext("webgl") !== null);
    test.skip(!webgl, "WebGL is not available");

    // Wait for the agent selector to load
    const agentSelector = page.getByRole("button", { name: /Select agent/i });
    await expect(agentSelector).toBeVisible({ timeout: 5000 });

    // Click the agent selector to open the dropdown
    await agentSelector.click();

    // Wait for the dropdown to appear and select the agent
    const agentOption = page.getByRole("option", { name: /Mock specialist chart agent/i });
    await expect(agentOption).toBeVisible({ timeout: 5000 });
    await agentOption.click();

    // Wait for the dropdown to close
    await expect(agentOption).not.toBeVisible({ timeout: 2000 });

    // Find the chat input textarea and type a message
    const chatPrompt = page.getByRole("textbox", { name: /message/i });
    await expect(chatPrompt).toBeVisible();
    await chatPrompt.fill("Show me a chart in 3D.");

    // Submit the message using the send button
    const submitButton = page.getByRole("button", { name: /send prompt/i });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for navigation to the chat page
    await page.waitForURL(/\/chat\/.+/, { timeout: 5000 });

    // Wait for the answer, which calls the tool that shows a chart
    const assistantMessage = page.locator("article").filter({ hasText: "This is a mock response" });
    await expect(assistantMessage).toBeVisible({ timeout: 15000 });

    // Validate that the chart is drawn
    const chartFrame = assistantMessage.locator("iframe");
    await expect(chartFrame.contentFrame().locator("canvas")).toBeVisible({ timeout: 15000 });

    // Validate that the chart is only downloaded as the image that it can be
    await chartFrame.hover();
    await page.getByRole("button", { name: /download/i }).click();
    await expect(page.getByRole("menuitem", { name: /png image/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /svg image/i })).toHaveCount(0);
  });
});
