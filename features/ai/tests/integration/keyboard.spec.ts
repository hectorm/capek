import { expect, test } from "@playwright/test";

test.describe("keyboard", () => {
  test("keeps the focus on the prompt that the welcome page focuses", async ({ page }) => {
    await page.goto("/ai");
    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/ai$/);

    const prompt = page.getByRole("textbox", { name: /message/i });
    await expect(prompt).toBeFocused();
    // Gives the application time to move the focus after the navigation
    await page.waitForTimeout(500);
    await expect(prompt).toBeFocused();
  });
});
