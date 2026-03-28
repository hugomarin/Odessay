import { expect, test } from "@playwright/test"

test("preview invalid token shows not found state", async ({ page }) => {
  await page.goto("/preview/fixturepreviewnotfound0001")

  await expect(page.getByRole("heading", { name: "Preview link not found" })).toBeVisible()
  await expect(page.getByText("This link is invalid or has never been generated.")).toBeVisible()
})
