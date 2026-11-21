import { expect, test } from "@playwright/test";

test.describe("datasource studio", () => {
  test("creates a PostgreSQL datasource", async ({ page }) => {
    await page.goto("/studio/datasources");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /create/i }).click();

    const name = `orders-${crypto.randomUUID()}`;
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /^Name/ }).fill(name);
    await dialog.getByRole("combobox", { name: "Type" }).click();
    await expect(page.getByRole("option")).toHaveText(["ClickHouse", "MariaDB / MySQL", "PostgreSQL", "SQL Server"]);
    await page.getByRole("option", { name: "PostgreSQL" }).click();
    const connectionString = dialog.getByRole("textbox", { name: "Connection string" });
    await expect(connectionString).toHaveAttribute("placeholder", "postgres://<host>:5432/<database>");
    await connectionString.fill("postgres://db.example.com:5432/orders");
    await dialog.getByRole("button", { name: /^create$/i }).click();

    await expect(dialog).toBeHidden();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByRole("cell", { name: "PostgreSQL" })).toBeVisible();
  });
});
