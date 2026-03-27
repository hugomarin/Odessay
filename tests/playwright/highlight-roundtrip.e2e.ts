import { expect, test } from "@playwright/test"
import {
  focusRichEditor,
  markdownTextarea,
  openEditorHarness,
  switchToMarkdown,
  switchToRich,
} from "./helpers/editor"

test("highlight round-trip stays canonical in markdown and visible in rich mode", async ({ page }) => {
  await openEditorHarness(page)
  await focusRichEditor(page)
  await page.keyboard.type("Highlight me")
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
  await page.locator("#editor-action-highlight").click()

  await switchToMarkdown(page)
  const textarea = await markdownTextarea(page)
  await expect(textarea).toHaveValue(/==Highlight me==/)

  await textarea.fill("==Highlight me updated==")
  await switchToRich(page)
  await expect(page.locator(".odessay-editor-content mark")).toContainText("Highlight me updated")
})
