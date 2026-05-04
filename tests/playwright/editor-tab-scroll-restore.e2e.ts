import { expect, test } from "@playwright/test"

test("rich mode preserves visual scroll position across workspace tab switches", async ({ page }) => {
  await page.goto("/perf/write-harness")

  // Wait for the editor to be ready
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
  await expect(page.locator(".odessay-editor-content")).toBeVisible()

  // Inject a long document directly via ProseMirror so the viewport becomes scrollable
  const editor = page.locator(".odessay-editor-content")
  await editor.click()

  const longParagraph =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\n"

  const repeatedText = longParagraph.repeat(60)

  await editor.evaluate((element, text) => {
    const view = (element as HTMLElement & { view?: { dispatch?: (tr: unknown) => void; state?: unknown } }).view
    if (view && typeof view.dispatch === "function") {
      // ProseMirror editor — insert text via transaction
      const { state } = view
      const tr = (state as { tr: { insertText: (text: string, pos?: number) => unknown } }).tr.insertText(text, 1)
      view.dispatch(tr)
    } else {
      // Fallback: set text content directly
      element.textContent = text
    }
  }, repeatedText)

  // Move cursor to the top of the document (so cursor is away from the scroll target)
  await page.keyboard.press("Control+Home")

  // Give the editor a moment to settle and layout
  await page.waitForTimeout(300)

  // Scroll down several screens using the editor writing area
  const editorWritingArea = page.locator('[data-testid="editor-writing-area"]')
  const scrollTarget = 3000

  await editorWritingArea.evaluate((element, target) => {
    element.scrollTop = target
  }, scrollTarget)

  // Also scroll window in case the harness scrolls there instead
  await page.evaluate((target) => {
    window.scrollTo(0, target)
  }, scrollTarget)

  await page.waitForTimeout(300)

  // Record scroll positions before tab switch
  const preScroll = await page.evaluate(() => ({
    editorScrollTop: document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')?.scrollTop ?? 0,
    windowScrollY: window.scrollY,
    mainScrollTop: document.querySelector<HTMLElement>("main")?.scrollTop ?? 0,
  }))

  // The document must have been scrolled for the test to be meaningful
  const totalScroll = preScroll.editorScrollTop + preScroll.windowScrollY + preScroll.mainScrollTop
  expect(totalScroll).toBeGreaterThan(1000)

  // Create a new tab (opens a blank draft)
  await page.getByRole("button", { name: "New writing" }).click()

  // Wait for the new writing tab to become active
  await expect(page.getByLabel(/Open Untitled/)).toBeVisible()

  // Switch back to the original tab (the first "Open" button that is not the draft)
  const originalTabButton = page.locator('button[aria-label^="Open"]').first()
  await originalTabButton.click()

  // Give any async restore a moment to settle
  await page.waitForTimeout(500)

  // Record scroll positions after returning
  const postScroll = await page.evaluate(() => ({
    editorScrollTop: document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')?.scrollTop ?? 0,
    windowScrollY: window.scrollY,
    mainScrollTop: document.querySelector<HTMLElement>("main")?.scrollTop ?? 0,
  }))

  // The total scroll must be restored (allow a small tolerance for sub-pixel differences)
  const preTotal = preScroll.editorScrollTop + preScroll.windowScrollY + preScroll.mainScrollTop
  const postTotal = postScroll.editorScrollTop + postScroll.windowScrollY + postScroll.mainScrollTop
  expect(Math.abs(postTotal - preTotal)).toBeLessThanOrEqual(50)
})
