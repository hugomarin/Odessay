import { expect, test } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown } from "./helpers/editor"

test("markdown bold toggle unwraps without duplicating markers", async ({ page }) => {
  await openEditorHarness(page)
  await switchToMarkdown(page)

  const textarea = await markdownTextarea(page)
  await textarea.fill("**Según Altman**")

  await textarea.evaluate((node) => {
    const element = node as HTMLTextAreaElement
    const source = element.value
    const start = source.indexOf("Según")
    const end = start + "Según Altman".length
    element.setSelectionRange(start, end)
    element.focus()
  })

  await page.locator("#editor-action-bold").click()
  await expect(textarea).toHaveValue("Según Altman")
})
