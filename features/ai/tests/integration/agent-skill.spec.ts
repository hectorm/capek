import { expect, test } from "@playwright/test";

import { answer, startChat } from "./chat";

test.describe("agent skill", () => {
  test("runs a skill as a tool", async ({ page }) => {
    await startChat(page, "Mock specialist tool agent", "Encode 'Hello World' with skill_rot13.");

    await expect(answer(page, "Uryyb Jbeyq")).toBeVisible();
  });

  test("shows the table of a feature tool that a skill calls", async ({ page }) => {
    await startChat(page, "Mock specialist table agent", "Show sales using skill_sales_table.");

    const message = answer(page, "Sales table ready");
    await expect(message.getByRole("cell", { name: "Books", exact: true })).toBeVisible();
    await expect(message.getByRole("cell", { name: "350", exact: true })).toBeVisible();
  });
});
