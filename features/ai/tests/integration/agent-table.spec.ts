import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { answer, startChat } from "./chat";

test.describe("agent table", () => {
  test("shows a table that can be sorted, filtered and downloaded", async ({ page }) => {
    await startChat(page, "Mock specialist table agent", "Show me a table.");

    const message = answer(page, "This is a mock response");
    await expect(message.getByText("First 100 rows of 150")).toBeVisible();
    await expect(message.getByRole("cell").first()).toHaveText("item 1");

    await expect(page.getByRole("button", { name: /stop generating/i })).toBeHidden();
    await page.reload();
    await expect(message.getByText("First 100 rows of 150")).toBeVisible();

    const totalHeader = message.getByRole("button", { name: "Sort by total" });
    await totalHeader.click();
    await totalHeader.click();
    await expect(message.getByText("Rows: 150")).toBeVisible();
    await expect(message.getByRole("cell").first()).toHaveText("item 150");

    await message.getByRole("button", { name: "Filter by name" }).click();
    await message.getByRole("textbox", { name: "Search" }).fill("ITEM 14");
    await expect(message.getByText("Rows: 11 of 150")).toBeVisible();
    await expect(message.getByRole("cell").first()).toHaveText("item 149");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      message.getByRole("button", { name: /download csv/i }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("mock-table.csv");
    const lines = Array.from({ length: 150 }, (_, index) => `item ${String(index + 1)},${String(index + 1)}`);
    expect(await readFile(await download.path(), "utf8")).toBe(`\uFEFF${["name,total", ...lines, ""].join("\r\n")}`);
  });
});
