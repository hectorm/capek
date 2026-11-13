import { expect, test } from "@playwright/test";

test.describe("agent priority", () => {
  test("lists the agents with a priority first", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /select agent/i }).click();

    const options = page.getByRole("option");
    await expect(options.first()).toHaveText(/Mock triage agent/);
    await expect(options.nth(1)).not.toHaveText(/Mock triage agent/);
  });
});
