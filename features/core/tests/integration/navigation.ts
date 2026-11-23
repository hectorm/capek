import type { Page } from "@playwright/test";

const waitForHydration = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false);
};

export const openPage = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await waitForHydration(page);
};

export const reloadPage = async (page: Page): Promise<void> => {
  await page.reload();
  await waitForHydration(page);
};

export const waitForPageLoad = async (page: Page, navigate: () => Promise<unknown>): Promise<void> => {
  const loading = await page.evaluateHandle(() => {
    return {
      end: new Promise((resolve) => {
        window.useNuxtApp?.().hooks.hookOnce("page:loading:end", () => {
          setTimeout(resolve);
        });
      }),
    };
  });

  await navigate();
  await loading.evaluate(({ end }) => end);
};
