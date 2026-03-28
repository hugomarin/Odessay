import { expect, test } from "@playwright/test"

test("preview operational failure shows unavailable state", async ({ page }) => {
  await page.goto("/preview/fixturepreviewunavailable001")

  await expect(page.getByRole("heading", { name: "Preview temporarily unavailable" })).toBeVisible()
  await expect(page.getByText("Odessay could not load this writing right now.")).toBeVisible()
})
