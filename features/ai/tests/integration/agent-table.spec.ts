import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test.describe("Agent Table", () => {
  test("should show a table that can be sorted, filtered and downloaded", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the app to be ready
    await page.waitForLoadState("networkidle");

    // Wait for the agent selector to load
    const agentSelector = page.getByRole("button", { name: /Select agent/i });
    await expect(agentSelector).toBeVisible({ timeout: 5000 });

    // Click the agent selector to open the dropdown
    await agentSelector.click();

    // Wait for the dropdown to appear and select the agent
    const agentOption = page.getByRole("option", { name: /Mock specialist table agent/i });
    await expect(agentOption).toBeVisible({ timeout: 5000 });
    await agentOption.click();

    // Wait for the dropdown to close
    await expect(agentOption).not.toBeVisible({ timeout: 2000 });

    // Find the chat input textarea and type a message
    const chatPrompt = page.getByRole("textbox", { name: /message/i });
    await expect(chatPrompt).toBeVisible();
    await chatPrompt.fill("Show me a table.");

    // Submit the message using the send button
    const submitButton = page.getByRole("button", { name: /send prompt/i });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for navigation to the chat page
    await page.waitForURL(/\/chat\/.+/, { timeout: 5000 });

    // Wait for the answer, which calls the tool that shows a table
    const assistantMessage = page.locator("article").filter({ hasText: "This is a mock response" });
    await expect(assistantMessage).toBeVisible({ timeout: 15000 });

    // Validate that the answer only has the first rows of the table
    await expect(assistantMessage.getByText("First 20 rows of 30")).toBeVisible();
    await expect(assistantMessage.getByRole("cell", { name: "item 20", exact: true })).toBeVisible();
    await expect(assistantMessage.getByRole("cell", { name: "item 21", exact: true })).not.toBeAttached();

    // Validate that the table is kept with the answer
    await expect(page.getByRole("button", { name: /stop generating/i })).not.toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(assistantMessage.getByText("First 20 rows of 30")).toBeVisible({ timeout: 15000 });

    // Validate that sorting the table takes all its rows
    const totalHeader = assistantMessage.getByRole("button", { name: "Sort by total" });
    await totalHeader.click();
    await totalHeader.click();
    await expect(assistantMessage.getByText("Rows: 30")).toBeVisible();
    await expect(assistantMessage.getByRole("cell").first()).toHaveText("item 30");

    // Validate that filtering the table only leaves the rows that match
    await assistantMessage.getByRole("button", { name: "Filter by name" }).click();
    await assistantMessage.getByRole("textbox", { name: "Search" }).fill("ITEM 1");
    await expect(assistantMessage.getByText("Rows: 11 of 30")).toBeVisible();
    await expect(assistantMessage.getByRole("cell").first()).toHaveText("item 19");

    // Validate that the table is downloaded with all its rows
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      assistantMessage.getByRole("button", { name: /download csv/i }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("Mock table.csv");
    const lines = Array.from({ length: 30 }, (_, index) => `item ${String(index + 1)},${String(index + 1)}`);
    expect(await readFile(await download.path(), "utf8")).toBe(`\uFEFF${["name,total", ...lines, ""].join("\r\n")}`);
  });
});
