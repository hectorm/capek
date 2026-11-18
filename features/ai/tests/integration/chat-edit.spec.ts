import type { Route } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { answer, startChat } from "./chat";

test.describe("chat edit", () => {
  test("keeps a rejected edit open until cancelled", async ({ page }) => {
    const original = "First question";
    const draft = "Revised question";
    await startChat(page, "Mock single iteration agent", original);

    const composer = page.getByPlaceholder(/type your message/i);
    await composer.fill("My next question");
    await answer(page, original).getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("article").getByRole("textbox", { name: "Edit message" });
    const resend = page.getByRole("button", { name: "Resend", exact: true });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(original);
    await expect(resend).toBeDisabled();
    await editor.fill(draft);

    await page.route("**/api/ai/chat/send", (route) => route.fulfill({ status: 409 }));
    await resend.click();
    await expect(page.getByText("Failed to send message", { exact: true })).toBeVisible();
    await expect(editor).toHaveValue(draft);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(composer).toHaveValue("My next question");

    await page.reload();
    await expect(answer(page, original)).toBeVisible();
    await expect(answer(page, "This is a mock response")).toBeVisible();
  });

  test("keeps the draft when a resend is stopped before acceptance", async ({ page }) => {
    await startChat(page, "Mock single iteration agent", "First question");
    await answer(page, "First question").getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Edit message" });
    await editor.fill("Revised question");

    const pending = Promise.withResolvers<Route>();
    await page.route("**/api/ai/chat/send", pending.resolve);
    await page.getByRole("button", { name: "Resend", exact: true }).click();
    const request = await pending.promise;
    await page.getByRole("button", { name: /stop generating/i }).click();

    await expect(editor).toBeEnabled();
    await expect(editor).toHaveValue("Revised question");
    await expect(answer(page, "This is a mock response")).toBeVisible();
    await request.abort();
  });

  test("replaces later messages when an edit is resent", async ({ page }) => {
    await startChat(page, "Mock single iteration agent", "First question");
    const composer = page.getByPlaceholder(/type your message/i);
    for (const text of ["Second question", "Third question"]) {
      await composer.fill(text);
      await page.getByRole("button", { name: /send prompt/i }).click();
      await expect(answer(page, text).getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    }

    await composer.fill("A separate draft");
    await answer(page, "Second question").getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Edit message" }).fill("Revised question");
    await expect(answer(page, "Third question")).toBeVisible();
    await page.getByRole("button", { name: "Resend", exact: true }).click();
    await expect(answer(page, "Revised question").getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(composer).toHaveValue("A separate draft");

    await page.reload();
    await expect(page.locator('article[data-role="user"]')).toHaveText(["First question", "Revised question"]);
    await expect(answer(page, "This is a mock response")).toHaveCount(2);
  });
});
