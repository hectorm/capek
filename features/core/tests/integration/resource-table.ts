import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const filterByName = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("button", { name: "Filter by Name" }).click();

  const search = page.getByRole("textbox", { name: "Search" });
  await search.fill(name);
  await search.press("Enter");
  await search.press("Escape");
  await expect(search).toBeHidden();
};
