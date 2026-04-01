import { expect, test } from "@playwright/test"

test("write route shows a desktop-only gate on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/perf/write-harness")

  await expect(page.getByTestId("write-mobile-gate")).toBeVisible()
  await expect(page.getByText("Writing is desktop only")).toBeVisible()
  await expect(page.getByText("Odessay keeps the writing space on larger screens.")).toBeVisible()
})
