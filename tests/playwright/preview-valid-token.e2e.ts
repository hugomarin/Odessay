import { expect, test } from "@playwright/test"

test("preview valid token renders read-only body", async ({ page }) => {
  await page.goto("/preview/fixturepreviewoktoken0001")

  await expect(page.getByText("Read-only UX preview")).toBeVisible()
  await expect(page.getByTestId("preview-body")).toContainText("Preview fixture content")
})
