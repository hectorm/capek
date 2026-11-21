import { expect, test } from "@playwright/test";

import { createGroup, openGroupEditor } from "#layers/core/tests/integration/groups";

test.describe("settings", () => {
  test("shows the general settings", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: /branding/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /application name/i })).toHaveValue("Test");
  });

  test("lists the users", async ({ page }) => {
    await page.goto("/settings/users");

    await expect(page.getByRole("cell", { name: "admin@localhost" })).toBeVisible();
  });

  test("keeps groups sorted and filtered after a save", async ({ page }) => {
    await page.goto("/settings/groups");
    await page.getByRole("button", { name: "Filter by Name" }).click();
    const suffix = crypto.randomUUID();
    const search = page.getByRole("textbox", { name: "Search" });
    await search.fill(suffix);
    await search.press("Enter");
    await search.press("Escape");

    const alpha = `Alpha-${suffix}`;
    const zulu = `Zulu-${suffix}`;
    for (const name of [alpha, zulu]) {
      await createGroup(page, name);
    }
    const names = page.getByRole("cell", { name: new RegExp(suffix) });
    await expect(names).toHaveText([alpha, zulu]);

    await openGroupEditor(page, alpha);
    const dialog = page.getByRole("dialog");
    const renamed = `Renamed-${crypto.randomUUID()}`;
    await dialog.getByRole("textbox", { name: "Name" }).fill(renamed);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(names).toHaveText([zulu]);
    await expect(page.getByRole("cell", { name: renamed })).toHaveCount(0);
  });

  test("shows an error when a group cannot be loaded", async ({ page }) => {
    await page.goto("/settings/groups");
    const name = `Unloaded-${crypto.randomUUID()}`;
    await createGroup(page, name);

    await page.route("**/api/trpc/*group.read*", (route) => route.abort());
    await openGroupEditor(page, name);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toHaveText(/Failed to load the data/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
});
