import { expect, test } from "@playwright/test"

/**
 * @contract ODE-406 — contentless desktop lifecycle
 * @service DocumentService.createDraft()
 */
test("contentless desktop lifecycle has zero durable effects", async ({ page }) => {
  await page.goto("/perf/write-new-harness")

  await expect(page.getByTestId("desktop-draft-lifecycle-counters")).toBeAttached()
  await expect(page.getByTestId("editor-empty-state")).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe("/perf/write-new-harness")
  await expect.poll(() => page.evaluate(() => window.__ODESSAY_DESKTOP_DRAFT_LIFECYCLE__)).toMatchObject({
    installed: true,
    materializations: 0,
    filesystemWrites: 0,
    manifestWrites: 0,
    catalogWrites: 0,
    syncEnqueues: 0,
    cloudWrites: 0,
  })

  await page.getByTestId("editor-empty-state").getByRole("button", { name: "New writing" }).click()
  await expect(page.getByTestId("editor-topbar")).toBeVisible()
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
  await expect(page.getByText("Saved locally")).toHaveCount(0)

  await page.goto("/perf/write-new-harness")
  await expect.poll(() => page.evaluate(() => window.__ODESSAY_DESKTOP_DRAFT_LIFECYCLE__?.materializations)).toBe(0)
  await expect(page.getByText("Saved locally")).toHaveCount(0)
})
