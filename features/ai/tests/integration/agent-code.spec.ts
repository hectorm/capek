import { expect, test } from "@playwright/test";

import { answer, startChat } from "./chat";

test.describe("agent code interpreter", () => {
  test("runs code with the skills, the MCP servers and the workspace", async ({ page }) => {
    await startChat(page, "Mock specialist code agent", "Run some code.");

    const message = answer(page, "This is a mock response");
    await expect(message).toContainText("ROT13 Cipher Skill");
    await expect(message).toContainText("Uryyb Jbeyq");
    await expect(message).toContainText("Mock_MCP");
    await expect(message).toContainText("Mock search result");
    await expect(message).toContainText("VFS test content");
  });
});
