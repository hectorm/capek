import { expect, test } from "@playwright/test";

test.describe("settings", () => {
  test("shows the general settings", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: /branding/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /application name/i })).toHaveValue("Test");
  });

  test("lists the users", async ({ page }) => {
    await page.goto("/settings/users");

    await expect(page.getByRole("cell", { name: "admin@localhost" })).toBeVisible();
  });
});
