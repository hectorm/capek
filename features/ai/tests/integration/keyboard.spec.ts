import { expect, test } from "@playwright/test";

import { composer } from "#layers/ai/tests/integration/chat";
import { openPage, waitForPageLoad } from "#layers/core/tests/integration/navigation";

test.describe("keyboard", () => {
  test("keeps the focus on the prompt that the welcome page focuses", async ({ page }) => {
    await openPage(page, "/ai");
    await page.getByRole("button", { name: "Admin" }).click();
    await waitForPageLoad(page, () => page.getByRole("menuitem", { name: "Settings" }).click());
    await expect(page).toHaveURL(/\/settings$/);
    await waitForPageLoad(page, () => page.goBack());
    await expect(page).toHaveURL(/\/ai$/);

    await expect(composer(page)).toBeFocused();
  });
});
