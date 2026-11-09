import { expect, test } from "@playwright/test";

test.describe("Agent Code Skill Documentation", () => {
  test("should read SKILL.md file with documentation content", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the app to be ready
    await page.waitForLoadState("networkidle");

    // Verify the welcome page loaded
    await expect(page.locator("h1")).toContainText(/welcome/i);

    // Wait for the agent selector to load
    const agentSelector = page.getByRole("button", { name: /Select agent/i });
    await expect(agentSelector).toBeVisible({ timeout: 5000 });

    // Click the agent selector to open the dropdown
    await agentSelector.click();

    // Wait for the dropdown to appear and select the agent
    const agentOption = page.getByRole("option", { name: /Mock specialist code agent/i });
    await expect(agentOption).toBeVisible({ timeout: 5000 });
    await agentOption.click();

    // Wait for the dropdown to close
    await expect(agentOption).not.toBeVisible({ timeout: 2000 });

    // Find the chat input textarea and type a message
    const chatPrompt = page.getByRole("textbox", { name: /message/i });
    await expect(chatPrompt).toBeVisible();

    const testMessage = "Read the SKILL.md file for the rot13 skill.";
    await chatPrompt.fill(testMessage);

    // Submit the message using the send button
    const submitButton = page.getByRole("button", { name: /send prompt/i });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for navigation to the chat page
    await page.waitForURL(/\/chat\/.+/, { timeout: 5000 });
    expect(page.url()).toMatch(/\/chat\/[a-zA-Z0-9-]+/);

    // Wait for the user message to appear in the chat
    const userMessage = page.locator(".markdown-body").filter({ hasText: testMessage });
    await expect(userMessage).toBeVisible({ timeout: 5000 });

    // Validate the assistant response
    const response = page.locator("article");
    await expect(response.filter({ hasText: "name: rot13" })).toBeVisible({ timeout: 15000 });
    await expect(response.filter({ hasText: "ROT13 Cipher Skill" })).toBeVisible({ timeout: 5000 });
    await expect(response.filter({ hasText: "ROT13 substitution cipher" })).toBeVisible({ timeout: 5000 });
    await expect(response.filter({ hasText: "text" })).toBeVisible({ timeout: 5000 });
    await expect(response.filter({ hasText: "Uryyb Jbeyq" })).toBeVisible({ timeout: 5000 });

    // Verify the page is still functional
    await expect(page.locator("main")).toBeVisible();

    // Verify the chat input is still available for follow-up messages
    const followUpInput = page.locator("textarea").first();
    await expect(followUpInput).toBeVisible();
    await expect(followUpInput).toBeEnabled();
  });
});
