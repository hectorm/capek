import { expect, test } from "@playwright/test";

import { answer, startChat } from "./chat";

test.describe("agent MCP", () => {
  test("calls an MCP tool through a specialist", async ({ page }) => {
    await startChat(page, "Mock triage agent", "Call mock_search.");

    await expect(answer(page, 'Mock search result for: "mock test query"')).toBeVisible();
  });
});
