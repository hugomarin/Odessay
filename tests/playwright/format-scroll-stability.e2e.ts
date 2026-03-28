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
    const container = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
    if (container) {
      container.scrollTop = container.scrollHeight
    }
    element.scrollTop = element.scrollHeight
    const start = Math.max(0, element.value.length - 40)
    element.setSelectionRange(start, element.value.length)
    element.focus()
    return element.selectionStart
  })

  const readViewport = async () =>
    page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
      const shell = document.querySelector<HTMLElement>("main")
      const source = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')

      return {
        containerScrollTop: container?.scrollTop ?? 0,
        textareaScrollTop: source?.scrollTop ?? 0,
        shellScrollTop: shell?.scrollTop ?? 0,
        windowScrollY: window.scrollY,
        selectionStart: source?.selectionStart ?? 0,
      }
    })

  const assertNoJumpForAction = async (actionId: string) => {
    const before = await readViewport()
    await page.locator(actionId).click()
    const after = await readViewport()

    expect(after.containerScrollTop).toBeGreaterThanOrEqual(Math.max(0, before.containerScrollTop - 28))
    expect(after.textareaScrollTop).toBeGreaterThanOrEqual(Math.max(0, before.textareaScrollTop - 28))
    expect(after.shellScrollTop).toBeGreaterThanOrEqual(Math.max(0, before.shellScrollTop - 28))
    expect(after.windowScrollY).toBeGreaterThanOrEqual(Math.max(0, before.windowScrollY - 28))
    expect(after.selectionStart).toBeGreaterThan(beforeSelectionStart - 20)
  }

  await assertNoJumpForAction("#editor-action-heading-1")
  await assertNoJumpForAction("#editor-action-italic")
  await assertNoJumpForAction("#editor-action-highlight")

  const markdownAfter = await textarea.evaluate((node) => (node as HTMLTextAreaElement).value)

  expect(markdownAfter).toContain("# line 220")
})
