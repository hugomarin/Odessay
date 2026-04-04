import { expect, test } from "@playwright/test"

const buildUuid = (index: number) => {
  const suffix = index.toString(16).padStart(12, "0")
  return `550e8400-e29b-41d4-a716-${suffix}`
}

test("write route race fallback keeps editor available during immediate paste", async ({ page }) => {
  for (let index = 0; index < 20; index += 1) {
    const writingId = buildUuid(index)

    await page.goto(`/perf/write-transient-race/${writingId}`)
    await expect(page).toHaveURL(`/perf/write-transient-race/${writingId}`)
    await expect(page.getByTestId("editor-topbar")).toBeVisible()
    await expect(page.getByTestId("editor-writing-area")).toBeVisible()
    await expect(page.getByText("This page could not be found.")).toHaveCount(0)

    const editor = page.locator(".odessay-editor-content")
    await editor.click()
    await page.keyboard.insertText(`Immediate paste iteration ${index}`)
  }
})
