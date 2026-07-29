import { expect, test, type Page } from "@playwright/test"

async function readCounters(page: Page) {
  return JSON.parse((await page.getByTestId("desktop-draft-lifecycle-counters").textContent()) ?? "{}")
}

/**
 * @contract ODE-406 — first real desktop content materializes exactly once
 * @service DocumentService.createDraft()
 */
test("first desktop paste creates exactly one durable identity", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
  })
  // Use the perf harness so the test runs outside the auth-protected layout
  await page.goto("/perf/write-new-harness")

  await expect(page.getByTestId("editor-empty-state")).toBeVisible()
  await page.getByTestId("editor-empty-state").getByRole("button", { name: "New writing" }).click()
  await expect(page.getByTestId("editor-topbar")).toBeVisible()
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()

  await expect.poll(async () => (await readCounters(page)).materializations).toBe(0)

  // First paste should persist immediately
  const editor = page.locator(".odessay-editor-content")
  await editor.click()
  await page.keyboard.insertText("First paste content")

  // Content should be visible in the editor
  await expect(editor).toContainText("First paste content")

  await expect.poll(() => readCounters(page)).toMatchObject({
    materializations: 1,
    filesystemWrites: 1,
    manifestWrites: 1,
    catalogWrites: 1,
    syncEnqueues: 1,
    cloudWrites: 0,
  })

  await expect(page.getByText("Saved locally")).toBeVisible()
  await page.getByRole("button", { name: "Close Untitled" }).click()
  await expect(page.getByTestId("editor-empty-state")).toBeVisible()
  await expect.poll(async () => (await readCounters(page)).materializations).toBe(1)
})
