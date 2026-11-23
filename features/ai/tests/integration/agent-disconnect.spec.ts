import { expect, test } from "@playwright/test";

import { answer, startChat } from "#layers/ai/tests/integration/chat";

test.describe("agent disconnect", () => {
  test("saves the answer streamed before the client disconnects", async ({ page }) => {
    await startChat(page, "Mock single iteration agent", "Say hello and end on release.");

    const message = answer(page, "This is a mock response");
    await expect(message).toBeVisible();
    await expect(page.getByRole("button", { name: /stop generating/i })).toBeVisible();

    await page.reload();
    await expect(message).toBeVisible();
  });
});
