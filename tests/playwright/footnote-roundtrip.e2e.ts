import { expect, test } from "@playwright/test"
import {
  markdownTextarea,
  openEditorHarness,
  switchToMarkdown,
  switchToRich,
  typeInRichEditor,
} from "./helpers/editor"

test("footnotes preserve refs and definitions across rich/markdown toggles", async ({ page }) => {
  await openEditorHarness(page)
  await typeInRichEditor(page, "Texto con nota")

  await page.locator("#editor-action-footnote").click()
  await page.getByPlaceholder("Add note text").fill("Primera nota")
  await page.getByRole("button", { name: "Insert footnote" }).click()

  await switchToMarkdown(page)
  const textarea = await markdownTextarea(page)
  await expect(textarea).toHaveValue(/\[\^1\]/)
  await expect(textarea).toHaveValue(/\[\^1\]: Primera nota/)

  await textarea.fill("Texto con nota[^1]\n\n[^1]: Nota actualizada")
  await page.keyboard.press("Escape")
  await switchToRich(page)
  await expect(page.locator(".odessay-editor-content .footnote-ref")).toContainText("1")

  await switchToMarkdown(page)
  await expect(await markdownTextarea(page)).toHaveValue(/\[\^1\]: Nota actualizada/)
})
