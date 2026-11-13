import { expect, test } from "@playwright/test";

import { answer, startChat } from "./chat";

test.describe("agent max iterations", () => {
  test("keeps the partial answer of an agent that runs out of iterations", async ({ page }) => {
    await startChat(page, "Mock single iteration cutoff agent", "Run until the iteration limit.");

    const error = "The agent reached its maximum number of steps without finishing the answer";
    await expect(page.getByText(error, { exact: true })).toBeVisible();

    await page.reload();
    await expect(answer(page, "Partial answer before cutoff")).toBeVisible();
  });
});
