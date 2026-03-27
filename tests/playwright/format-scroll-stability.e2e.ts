import { expect, test } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown } from "./helpers/editor"

test("structural formatting in long markdown keeps viewport near editing point", async ({ page }) => {
  await openEditorHarness(page)
  await switchToMarkdown(page)

  const textarea = await markdownTextarea(page)
  const longMarkdown = Array.from({ length: 220 }, (_, index) => `line ${index + 1}`).join("\n")
  await textarea.fill(longMarkdown)

  const beforeSelectionStart = await textarea.evaluate((node) => {
    const element = node as HTMLTextAreaElement
    element.scrollTop = element.scrollHeight
    const start = Math.max(0, element.value.length - 40)
    element.setSelectionRange(start, element.value.length)
    element.focus()
    return element.selectionStart
  })

  await page.locator("#editor-action-heading-1").click()

  const [afterSelectionStart, markdownAfter] = await textarea.evaluate((node) => {
    const element = node as HTMLTextAreaElement
    return [element.selectionStart, element.value] as const
  })

  expect(afterSelectionStart).toBeGreaterThan(beforeSelectionStart - 12)
  expect(markdownAfter).toContain("# line 220")
})
