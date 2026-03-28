import { expect, test } from "@playwright/test"

test("preview revoked token shows revoked state", async ({ page }) => {
  await page.goto("/preview/fixturepreviewrevokedtoken001")

  await expect(page.getByRole("heading", { name: "Preview link revoked" })).toBeVisible()
  await expect(page.getByText("The author revoked this evaluation link.")).toBeVisible()
})
