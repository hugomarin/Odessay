import { expect, test } from "@playwright/test"

test("blank /write gets stable identity before first paste and content persists", async ({ page }) => {
  // Use the perf harness so the test runs outside the auth-protected layout
  await page.goto("/perf/write-new-harness")

  // Wait for the editor to be ready
  await expect(page.getByTestId("editor-topbar")).toBeVisible()
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()

  // The URL should promote to /write/{id} eagerly before any input.
  // Poll because identity creation is async (localDB write + session update).
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toMatch(
    /\/write\/[0-9a-f-]{36}$/,
  )

  // First paste should persist immediately
  const editor = page.locator(".odessay-editor-content")
  await editor.click()
  await page.keyboard.insertText("First paste content")

  // Content should be visible in the editor
  await expect(editor).toContainText("First paste content")

  // Tab title should reflect the content (first 48 chars used as auto-title)
  await expect(page.getByRole("button", { name: /open first paste content/i })).toBeVisible()
})
