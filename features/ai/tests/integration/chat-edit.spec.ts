import type { Route } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  answer,
  composer,
  editMessage,
  resend,
  sendMessage,
  startChat,
  userMessages,
} from "#layers/ai/tests/integration/chat";

test.describe("chat edit", () => {
  test("keeps a rejected edit open until cancelled", async ({ page }) => {
    const original = "First question";
    const draft = "Revised question";
    await startChat(page, "Mock single iteration agent", original);

    await composer(page).fill("My next question");
    const editor = await editMessage(page, original);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(original);
    await expect(resend(page)).toBeDisabled();
    await editor.fill(draft);

    await page.route("**/api/ai/chat/send", (route) => route.fulfill({ status: 409 }));
    await resend(page).click();
    await expect(page.getByText("Failed to send message", { exact: true })).toBeVisible();
    await expect(editor).toHaveValue(draft);
    await page
      .getByRole("article")
      .filter({ has: page.getByRole("textbox", { name: "Edit message" }) })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await expect(composer(page)).toHaveValue("My next question");

    await page.reload();
    await expect(answer(page, original)).toBeVisible();
    await expect(answer(page, "This is a mock response")).toBeVisible();
  });

  test("keeps the draft when a resend is stopped before acceptance", async ({ page }) => {
    await startChat(page, "Mock single iteration agent", "First question");
    const editor = await editMessage(page, "First question");
    await editor.fill("Revised question");

    const pending = Promise.withResolvers<Route>();
    await page.route("**/api/ai/chat/send", pending.resolve);
    await resend(page).click();
    const request = await pending.promise;
    await page.getByRole("button", { name: /stop generating/i }).click();

    await expect(editor).toBeEnabled();
    await expect(editor).toHaveValue("Revised question");
    await expect(answer(page, "This is a mock response")).toBeVisible();
    await request.abort();
  });

  test("replaces later messages when an edit is resent", async ({ page }) => {
    await startChat(page, "Mock single iteration agent", "First question");
    for (const text of ["Second question", "Third question"]) {
      await sendMessage(page, text);
      await expect(answer(page, text).getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    }

    await composer(page).fill("A separate draft");
    const editor = await editMessage(page, "Second question");
    await editor.fill("Revised question");
    await expect(answer(page, "Third question")).toBeVisible();
    await resend(page).click();
    await expect(answer(page, "Revised question").getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(composer(page)).toHaveValue("A separate draft");

    await page.reload();
    await expect(userMessages(page)).toHaveText(["First question", "Revised question"]);
    await expect(answer(page, "This is a mock response")).toHaveCount(2);
  });
});
