import type { Locator, Page } from "@playwright/test";

export const startChat = async (page: Page, agent: string, prompt: string): Promise<void> => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /select agent/i }).click();
  await page.getByRole("option", { name: agent }).click();
  await page.getByRole("textbox", { name: /message/i }).fill(prompt);
  await page.getByRole("button", { name: /send prompt/i }).click();
  await page.waitForURL(/\/chat\/.+/);
};

export const answer = (page: Page, text: string): Locator => {
  return page.locator("article").filter({ hasText: text });
};
