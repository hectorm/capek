import { expect, test } from "@playwright/test";

import { createGroup, insertGroup, openGroupEditor } from "#layers/core/tests/integration/groups";
import { openPage } from "#layers/core/tests/integration/navigation";
import { filterByName } from "#layers/core/tests/integration/resource-table";

test.describe("settings", () => {
  test("shows the general settings", async ({ page }) => {
    await openPage(page, "/settings");

    await expect(page.getByRole("heading", { name: "Branding" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Application name" })).toHaveValue("Test");
  });

  test("lists the users", async ({ page }) => {
    await openPage(page, "/settings/users");

    await expect(page.getByRole("cell", { name: "admin@localhost" })).toBeVisible();
  });

  test("keeps groups sorted and filtered after a save", async ({ page }) => {
    const suffix = crypto.randomUUID();
    await openPage(page, "/settings/groups");
    await filterByName(page, suffix);

    const alpha = `Alpha-${suffix}`;
    const zulu = `Zulu-${suffix}`;
    for (const name of [zulu, alpha]) {
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

  test("shows an error when a group cannot be loaded", async ({ page, request }) => {
    const name = `Unloaded-${crypto.randomUUID()}`;
    await insertGroup(request, name);
    await openPage(page, "/settings/groups");
    await filterByName(page, name);

    await page.route("**/api/trpc/*group.read*", (route) => route.abort());
    await openGroupEditor(page, name);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toHaveText(/Failed to load the data/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
});
