import { expect, test } from "@playwright/test";

test.describe("Agent disconnect", () => {
  test("saves the answer streamed before the client disconnects", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the app to be ready
    await page.waitForLoadState("networkidle");

    // Wait for the agent selector to load
    const agentSelector = page.getByRole("button", { name: /Select agent/i });
    await expect(agentSelector).toBeVisible({ timeout: 5000 });

    // Click the agent selector to open the dropdown
    await agentSelector.click();

    // Select an agent that answers without tools
    const agentOption = page.getByRole("option", { name: /Mock single iteration agent/i });
    await expect(agentOption).toBeVisible({ timeout: 5000 });
    await agentOption.click();
    await expect(agentOption).not.toBeVisible({ timeout: 2000 });

    // Type a message whose answer ends slowly
    const chatPrompt = page.getByRole("textbox", { name: /message/i });
    await expect(chatPrompt).toBeVisible();
    await chatPrompt.fill("Say hello and end slowly.");

    // Submit the message using the send button
    await page.getByRole("button", { name: /send prompt/i }).click();

    // Wait for navigation to the chat page
    await page.waitForURL(/\/chat\/.+/, { timeout: 5000 });

    // Validate the assistant response while it is still being streamed
    const assistantMessage = page.locator("article").filter({ hasText: "This is a mock response" });
    await expect(assistantMessage).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /stop generating/i })).toBeVisible();

    // Reload the page to disconnect, and again until the answer saved on disconnection is there
    await expect(async () => {
      await page.reload();
      await expect(assistantMessage).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });
  });
});
