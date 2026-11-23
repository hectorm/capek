import { expect, test } from "@playwright/test";

import { openPage } from "#layers/core/tests/integration/navigation";

test.describe("datasource studio", () => {
  test("creates a PostgreSQL datasource", async ({ page }) => {
    const name = `orders-${crypto.randomUUID()}`;
    await openPage(page, "/studio/datasources");
    await page.getByRole("button", { name: "Filter by Name" }).click();
    const search = page.getByRole("textbox", { name: "Search" });
    await search.fill(name);
    await search.press("Enter");
    await search.press("Escape");
    await page.getByRole("button", { name: /create/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /^Name/ }).fill(name);
    await dialog.getByRole("combobox", { name: "Type" }).click();
    await expect(page.getByRole("option")).toHaveText(["ClickHouse", "MariaDB / MySQL", "PostgreSQL", "SQL Server"]);
    await page.getByRole("option", { name: "PostgreSQL" }).click();
    await expect(page.getByRole("listbox")).toBeHidden();
    const connectionString = dialog.getByRole("textbox", { name: "Connection string" });
    await expect(connectionString).toHaveAttribute("placeholder", "postgres://<host>:5432/<database>");
    await connectionString.fill("postgres://db.example.com:5432/orders");
    await dialog.getByRole("button", { name: /^create$/i }).click();

    await expect(dialog).toBeHidden();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByRole("cell", { name: "PostgreSQL" })).toBeVisible();
  });
});
