import type { Page } from "@playwright/test";

export const openPage = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false);
};
