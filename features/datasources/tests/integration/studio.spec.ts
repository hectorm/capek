import { expect, test } from "@playwright/test";

test.describe("Datasources", () => {
  test("should show the datasources in the studio", async ({ page }) => {
    await page.goto("/studio/datasources");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toContainText(/studio/i);
    await expect(page.getByRole("link", { name: /datasources/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /create/i })).toBeVisible();
  });

  test("should create a PostgreSQL datasource", async ({ page }) => {
    await page.goto("/studio/datasources");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /create/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/datasource name/i).fill("orders");
    await dialog.getByRole("combobox").first().click();
    await expect(page.getByRole("option")).toHaveText(["ClickHouse", "MariaDB / MySQL", "PostgreSQL", "SQL Server"]);
    await page.getByRole("option", { name: "PostgreSQL" }).click();
    await dialog.getByPlaceholder("postgres://<host>:5432/<database>").fill("postgres://db.example.com:5432/orders");
    await dialog.getByRole("button", { name: /^create$/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("cell", { name: "orders" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PostgreSQL" })).toBeVisible();
  });
});
