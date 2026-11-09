import { expect, test } from "@playwright/test";

test.describe("Settings", () => {
  test("should show the general settings", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toContainText(/settings/i);
    await expect(page.getByRole("heading", { name: /branding/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /application name/i })).toHaveValue("Capek");
  });

  test("should list the signed in user", async ({ page }) => {
    await page.goto("/settings/users");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("cell", { name: "admin@localhost" })).toBeVisible();
  });

  test("should open the settings from the user menu", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByRole("menuitem", { name: /settings/i }).click();

    await expect(page).toHaveURL(/\/settings$/);
  });
});
