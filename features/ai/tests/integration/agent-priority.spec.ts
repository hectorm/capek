import { expect, test } from "@playwright/test";

import { openPage } from "#layers/core/tests/integration/navigation";

test.describe("agent priority", () => {
  test("lists the agents with a priority first", async ({ page }) => {
    await openPage(page, "/ai");
    await page.getByRole("button", { name: /select agent/i }).click();

    const options = page.getByRole("option");
    await expect(options.first()).toHaveText(/Mock triage agent/);
    await expect(options.nth(1)).not.toHaveText(/Mock triage agent/);
  });
});
