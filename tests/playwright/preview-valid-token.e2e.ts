import { expect, test } from "@playwright/test"

test("preview valid token renders read-only body", async ({ page }) => {
  await page.goto("/preview/fixturepreviewoktoken0001", { waitUntil: "domcontentloaded" })

  await expect(page.getByText("Read-only UX preview")).toBeVisible()
  await expect(page.getByTestId("preview-body")).toContainText("Preview fixture content")
  await expect(page.locator("#preview-body h1")).toContainText("Preview fixture heading")
  await expect(page.locator("#preview-body strong")).toContainText("content")
  await expect(page.locator("#preview-body ul li")).toHaveCount(2)
  await expect(page.locator("#preview-body table")).toBeVisible()
})
