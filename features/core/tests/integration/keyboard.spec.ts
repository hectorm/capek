import { expect, test } from "@playwright/test";

import { openPage, waitForPageLoad } from "#layers/core/tests/integration/navigation";

test.describe("keyboard", () => {
  test("skips to the content of the page", async ({ page }) => {
    await openPage(page, "/settings/groups");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    const content = page.getByRole("main");
    await expect(content).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(content.locator(":focus")).toBeVisible();
  });

  test("moves the focus to the content after a section is opened from the sidebar", async ({ page }) => {
    await openPage(page, "/settings/groups");
    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("menu")).toBeHidden();

    const content = page.getByRole("main");
    await expect(page.getByRole("textbox", { name: "Application name" })).toBeVisible();
    await expect(content).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(content.locator(":focus")).toBeVisible();
  });

  test("keeps the focus when only the query changes", async ({ page }) => {
    await openPage(page, "/settings/groups");

    const toggle = page.getByRole("button", { name: "Toggle sidebar" });
    await toggle.focus();
    // No link of the application changes only the query
    await page.evaluate(() => {
      history.pushState(history.state, "", "?first");
      history.pushState(history.state, "", "?second");
    });
    await waitForPageLoad(page, () => page.goBack());
    await expect(page).toHaveURL(/\?first$/);
    await expect(toggle).toBeFocused();
  });
});
