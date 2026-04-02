import { expect, test } from "@playwright/test"

test("desk shared tab shows shared writing", async ({ page }) => {
  await page.goto("/perf/desk-shared-harness")

  await expect(page).toHaveURL(/\/perf\/desk-shared-harness$/)
  await expect(page.getByTestId("desk-view-tab-shared")).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(page.getByTestId("desk-shared-list")).toBeVisible()
  await expect(page.getByTestId("desk-shared-writing-item")).toBeVisible()
  await expect(page.getByText("Shared fixture letter")).toBeVisible()
  await expect(page.getByText("Fixture Author @fixture-author")).toBeVisible()
})
