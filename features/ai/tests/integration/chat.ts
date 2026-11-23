import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { openPage } from "#layers/core/tests/integration/navigation";

export const startChat = async (page: Page, agent: string, prompt: string): Promise<void> => {
  await openPage(page, "/ai");
  await page.getByRole("button", { name: /select agent/i }).click();
  await page.getByRole("option", { name: agent }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
  await sendMessage(page, prompt);
  await page.waitForURL(/\/chat\/.+/);
};

export const answer = (page: Page, text: string): Locator => {
  return page.getByRole("article").filter({ hasText: text });
};

// The messages of the user are the ones that can be edited
export const userMessages = (page: Page): Locator => {
  return page.getByRole("article").filter({ has: page.getByRole("button", { name: "Edit", exact: true }) });
};

export const composer = (page: Page): Locator => {
  return page.getByRole("textbox", { name: /type your message/i });
};

export const sendMessage = async (page: Page, text: string): Promise<void> => {
  await composer(page).fill(text);
  await page.getByRole("button", { name: /send prompt/i }).click();
};

export const editMessage = async (page: Page, text: string): Promise<Locator> => {
  await answer(page, text).getByRole("button", { name: "Edit", exact: true }).click();
  return page.getByRole("article").getByRole("textbox", { name: "Edit message" });
};

export const resend = (page: Page): Locator => {
  return page.getByRole("button", { name: "Resend", exact: true });
};
