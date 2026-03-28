import { expect, test } from "@playwright/test"
import {
  markdownTextarea,
  openEditorHarness,
  switchToMarkdown,
  switchToRich,
  typeInRichEditor,
} from "./helpers/editor"

test("highlight round-trip stays canonical in markdown and visible in rich mode", async ({ page }) => {
  await openEditorHarness(page)
  await typeInRichEditor(page, "Highlight")
  await page.locator(".odessay-editor-content").click({ clickCount: 3 })
  await page.locator("#editor-action-highlight").click()

  await switchToMarkdown(page)
  const textarea = await markdownTextarea(page)
  await expect(textarea).toHaveValue(/==Highlight==/)

  await textarea.fill("==Highlight updated==")
  await switchToRich(page)
  await expect(page.locator(".odessay-editor-content mark")).toContainText("Highlight updated")
})
