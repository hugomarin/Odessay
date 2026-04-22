import { expect, test, type Page } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown } from "./helpers/editor"

type ShortcutPayload = {
  key: string
  code: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

async function dispatchShortcut(page: Page, payload: ShortcutPayload) {
  await page.evaluate((nextPayload) => {
    const event = new KeyboardEvent("keydown", {
      key: nextPayload.key,
      code: nextPayload.code,
      ctrlKey: nextPayload.ctrlKey ?? false,
      metaKey: nextPayload.metaKey ?? false,
      shiftKey: nextPayload.shiftKey ?? false,
      altKey: nextPayload.altKey ?? false,
      bubbles: true,
      cancelable: true,
    })

    window.dispatchEvent(event)
  }, payload)
}

test("editor supports integrated find and replace in rich and markdown modes", async ({ page }) => {
  await openEditorHarness(page)

  const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))
  const commandModifiers = isMac ? { metaKey: true } : { ctrlKey: true }

  const editor = page.locator(".odessay-editor-content")
  await editor.click()
  await page.keyboard.insertText("alpha beta alpha gamma alpha delta")

  await dispatchShortcut(page, { key: "f", code: "KeyF", ...commandModifiers })
  const panel = page.getByRole("region", { name: "Find and replace" })
  await expect(panel).toBeVisible()

  const findInput = page.getByLabel("Find text")
  await findInput.fill("alpha")
  await expect(panel).toContainText("1 of 3")

  await findInput.press("Enter")
  await expect(panel).toContainText("2 of 3")

  await dispatchShortcut(page, { key: "h", code: "KeyH", ...commandModifiers })
  const replaceInput = page.getByLabel("Replace text")
  await expect(replaceInput).toBeVisible()
  await replaceInput.fill("omega")
  await page.getByRole("button", { name: "Replace one" }).click({ force: true })

  await expect(panel).toContainText("2 pending replacements")
  await expect(editor).toContainText("alpha beta omega gamma alpha delta")

  await switchToMarkdown(page)
  const textarea = await markdownTextarea(page)
  await dispatchShortcut(page, { key: "f", code: "KeyF", ...commandModifiers })
  await findInput.fill("alpha")
  await expect(panel).toContainText("2 of 2")

  await dispatchShortcut(page, { key: "h", code: "KeyH", ...commandModifiers })
  await replaceInput.fill("theta")

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain('Replace 2 matches with "theta"?')
    void dialog.accept()
  })

  await page.getByRole("button", { name: "Replace all" }).click({ force: true })
  await expect(textarea).toHaveValue("theta beta omega gamma theta delta")

  await page.keyboard.press("Escape")
  await expect(panel).toBeHidden()
  await expect(page.locator(".odessay-markdown-source")).toBeFocused()
})
