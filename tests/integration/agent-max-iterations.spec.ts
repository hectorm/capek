import { expect, test } from "@playwright/test";

test.describe("Agent max iterations", () => {
  test("saves the answer when an agent finishes on its last allowed iteration", async ({ page }) => {
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

    // Select the agent limited to a single iteration
    const agentOption = page.getByRole("option", { name: /Mock single iteration agent/i });
    await expect(agentOption).toBeVisible({ timeout: 5000 });
    await agentOption.click();
    await expect(agentOption).not.toBeVisible({ timeout: 2000 });

    // Type a message that needs no tools
    const chatPrompt = page.getByRole("textbox", { name: /message/i });
    await expect(chatPrompt).toBeVisible();
    const testMessage = "Say hello.";
    await chatPrompt.fill(testMessage);

    // Submit the message using the send button
    await page.getByRole("button", { name: /send prompt/i }).click();

    // Wait for navigation to the chat page
    await page.waitForURL(/\/chat\/.+/, { timeout: 5000 });

    // Validate the assistant response
    const assistantMessage = page.locator("article").filter({ hasText: "This is a mock response" });
    await expect(assistantMessage).toBeVisible({ timeout: 15000 });

    // A clean completion must not surface a send error
    await expect(page.getByText("Failed to send message", { exact: true })).toHaveCount(0);

    // Reload the page and verify the answer was persisted
    await page.reload();
    await page.waitForLoadState("networkidle");
    const persisted = page.locator("article").filter({ hasText: "This is a mock response" });
    await expect(persisted).toBeVisible({ timeout: 5000 });
  });

  test("persists the partial answer and surfaces an error when an agent exhausts its iterations", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the app to be ready
    await page.waitForLoadState("networkidle");

    // Wait for the agent selector to load
    const agentSelector = page.getByRole("button", { name: /Select agent/i });
    await expect(agentSelector).toBeVisible({ timeout: 5000 });

    // Click the agent selector to open the dropdown
    await agentSelector.click();

    // Select the agent that always exhausts its iteration budget
    const agentOption = page.getByRole("option", { name: /Mock single iteration cutoff agent/i });
    await expect(agentOption).toBeVisible({ timeout: 5000 });
    await agentOption.click();
    await expect(agentOption).not.toBeVisible({ timeout: 2000 });

    // Send a message that keeps the agent calling tools until it runs out of iterations
    const chatPrompt = page.getByRole("textbox", { name: /message/i });
    await expect(chatPrompt).toBeVisible();
    await chatPrompt.fill("Run until the iteration limit.");

    // Submit the message using the send button
    await page.getByRole("button", { name: /send prompt/i }).click();

    // Wait for navigation to the chat page
    await page.waitForURL(/\/chat\/.+/, { timeout: 5000 });

    // Exhausting the iteration budget surfaces the send error toast
    await expect(page.getByText("Failed to send message", { exact: true })).toBeVisible({ timeout: 15000 });

    // Reload the page and verify the answer streamed before the cutoff was persisted
    await page.reload();
    await page.waitForLoadState("networkidle");
    const persisted = page.locator("article").filter({ hasText: "Partial answer before cutoff" });
    await expect(persisted).toBeVisible({ timeout: 5000 });
  });
});
