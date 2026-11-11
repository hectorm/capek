import { expect, test } from "@playwright/test";

test.describe("Agent priority", () => {
  test("should list the agents with a higher priority first", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the app to be ready
    await page.waitForLoadState("networkidle");

    // Wait for the agent selector to load
    const agentSelector = page.getByRole("button", { name: /Select agent/i });
    await expect(agentSelector).toBeVisible({ timeout: 5000 });

    // Click the agent selector to open the dropdown
    await agentSelector.click();

    // Validate that the agent with a priority comes before the ones sorted by name
    const agentOptions = page.getByRole("option");
    await expect(agentOptions.first()).toHaveText(/Mock triage agent/, { timeout: 5000 });
    await expect(agentOptions.nth(1)).not.toHaveText(/Mock triage agent/);
  });
});
