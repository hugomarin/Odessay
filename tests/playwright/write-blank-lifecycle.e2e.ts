import { expect, test } from "@playwright/test"

test("blank writing stays local-first until first sync", async ({ page }) => {
  await page.goto("/perf/write-new-harness")

  await expect(page.getByTestId("editor-topbar")).toBeVisible()
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toMatch(
    /\/write\/[0-9a-f-]{36}$/,
  )
  await expect(page.getByText("Saved locally")).toBeVisible()

  await page.getByRole("button", { name: "Properties panel" }).click()
  await expect(page.getByTestId("editor-panel-properties")).toBeVisible()
  await expect(
    page.getByText("Sharing, collections, PDF, and Word become available after the first sync."),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Generate link" })).toBeDisabled()

  await page.getByRole("button", { name: "Export as…" }).click()
  await expect(page.getByRole("button", { name: "Markdown (.md)" })).toBeEnabled()
  await expect(page.getByRole("button", { name: "PDF (.pdf)" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Word (.docx)" })).toBeDisabled()

  await page.goto("/perf/write-new-harness")
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toMatch(
    /\/write\/[0-9a-f-]{36}$/,
  )
  await expect(page.getByText("Saved locally")).toBeVisible()
})
