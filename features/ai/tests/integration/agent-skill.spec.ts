import { expect, test } from "@playwright/test";

import { answer, startChat } from "./chat";

test.describe("agent skill", () => {
  test("runs a skill as a tool", async ({ page }) => {
    await startChat(page, "Mock specialist tool agent", "Encode 'Hello World' with skill_rot13.");

    await expect(answer(page, "Uryyb Jbeyq")).toBeVisible();
  });
});
