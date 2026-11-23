import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const createGroup = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("button", { name: "Create" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
};

export const insertGroup = async (request: APIRequestContext, name: string): Promise<void> => {
  const created = await request.post("/api/trpc/group.create", { data: { json: { name } } });
  expect(created.ok()).toBe(true);
};

export const openGroupEditor = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
};
