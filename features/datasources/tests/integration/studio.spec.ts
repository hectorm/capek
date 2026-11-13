import { expect, test } from "@playwright/test";

test.describe("datasource studio", () => {
  test("creates a PostgreSQL datasource", async ({ page }) => {
    await page.goto("/studio/datasources");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /create/i }).click();

    const name = `orders-${crypto.randomUUID()}`;
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/datasource name/i).fill(name);
    await dialog.getByRole("combobox").first().click();
    await expect(page.getByRole("option")).toHaveText(["ClickHouse", "MariaDB / MySQL", "PostgreSQL", "SQL Server"]);
    await page.getByRole("option", { name: "PostgreSQL" }).click();
    await dialog.getByPlaceholder("postgres://<host>:5432/<database>").fill("postgres://db.example.com:5432/orders");
    await dialog.getByRole("button", { name: /^create$/i }).click();

    await expect(dialog).toBeHidden();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByRole("cell", { name: "PostgreSQL" })).toBeVisible();
  });
});
