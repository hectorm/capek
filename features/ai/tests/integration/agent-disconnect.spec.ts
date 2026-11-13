import { expect, test } from "@playwright/test";

import { answer, startChat } from "./chat";

test.describe("agent disconnect", () => {
  test("saves the answer streamed before the client disconnects", async ({ page }) => {
    await startChat(page, "Mock single iteration agent", "Say hello and end slowly.");

    const message = answer(page, "This is a mock response");
    await expect(message).toBeVisible();
    await expect(page.getByRole("button", { name: /stop generating/i })).toBeVisible();

    await expect(async () => {
      await page.reload();
      await expect(message).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
  });
});
