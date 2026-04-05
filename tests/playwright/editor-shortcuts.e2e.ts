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

test("editor shortcuts map to isolated actions without collisions", async ({ page }) => {
  await openEditorHarness(page)
  const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))
  const commandModifiers = isMac ? { metaKey: true } : { ctrlKey: true }
  const shiftCommandModifiers = isMac ? { metaKey: true, shiftKey: true } : { ctrlKey: true, shiftKey: true }

  const editor = page.locator(".odessay-editor-content")
  await editor.click()
  await editor.type("Shortcut target line")
  await editor.click({ clickCount: 3 })

  await dispatchShortcut(page, { key: "6", code: "Digit6", ...shiftCommandModifiers })
  await switchToMarkdown(page)
  let textarea = await markdownTextarea(page)
  await expect(textarea).toHaveValue(/> Shortcut target line/)

  await textarea.fill("Paragraph target")
  await textarea.focus()
  await textarea.evaluate((element) => {
    const node = element as HTMLTextAreaElement
    node.setSelectionRange(0, node.value.length)
  })
  await dispatchShortcut(page, { key: "1", code: "Digit1", ...shiftCommandModifiers })
  await expect(textarea).toHaveValue(/^# Paragraph target$/)
  await dispatchShortcut(page, { key: "2", code: "Digit2", ...shiftCommandModifiers })
  await expect(textarea).toHaveValue(/^## Paragraph target$/)
  await dispatchShortcut(page, { key: "9", code: "Digit9", ...shiftCommandModifiers })
  await expect(textarea).toHaveValue(/^### Paragraph target$/)
  await dispatchShortcut(page, { key: "0", code: "Digit0", ...shiftCommandModifiers })
  await expect(textarea).toHaveValue(/^Paragraph target$/)
  await dispatchShortcut(page, { key: "l", code: "KeyL", ...shiftCommandModifiers })
  await expect(textarea).toHaveValue(/^- Paragraph target$/)
  await dispatchShortcut(page, { key: "o", code: "KeyO", ...shiftCommandModifiers })
  await expect(textarea).toHaveValue(/^1\. Paragraph target$/)

  await page.getByRole("button", { name: "Rich" }).click()
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press(isMac ? "Meta+A" : "Control+A")

  await dispatchShortcut(page, { key: "b", code: "KeyB", ...commandModifiers })
  await expect(page.locator(".odessay-editor-content strong")).toContainText("Paragraph target")
  await dispatchShortcut(page, { key: "i", code: "KeyI", ...commandModifiers })
  await expect(page.locator(".odessay-editor-content em")).toContainText("Paragraph target")
  await dispatchShortcut(page, { key: "x", code: "KeyX", ...shiftCommandModifiers })
  await expect(page.locator(".odessay-editor-content s")).toContainText("Paragraph target")
  await dispatchShortcut(page, { key: "h", code: "KeyH", ...shiftCommandModifiers })
  await expect(page.locator(".odessay-editor-content mark")).toContainText("Paragraph target")
  await dispatchShortcut(page, { key: "c", code: "KeyC", ...shiftCommandModifiers })
  await expect(page.locator(".odessay-editor-content code")).toContainText("Paragraph target")
  await dispatchShortcut(page, { key: "d", code: "KeyD", ...shiftCommandModifiers })
  await expect(page.locator(".odessay-editor-content pre")).toHaveCount(1)

  await dispatchShortcut(page, { key: "k", code: "KeyK", ...commandModifiers })
  await expect(page.getByRole("dialog", { name: "Insert link" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Insert link" })).toBeHidden()

  await dispatchShortcut(page, { key: "a", code: "KeyA", ...shiftCommandModifiers })
  await expect(page.getByRole("dialog", { name: "Insert footnote" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Insert footnote" })).toBeHidden()

  await dispatchShortcut(page, { key: "t", code: "KeyT", ...shiftCommandModifiers })
  await expect(page.getByRole("dialog", { name: "Insert table" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Insert table" })).toBeHidden()

  await dispatchShortcut(page, { key: "f", code: "KeyF", ...shiftCommandModifiers })
  await expect(page.locator("#editor-topbar")).toBeHidden()
  await dispatchShortcut(page, { key: "f", code: "KeyF", ...shiftCommandModifiers })
  await expect(page.locator("#editor-topbar")).toBeVisible()

  await dispatchShortcut(page, { key: ",", code: "Comma", ...commandModifiers })
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/)

  await openEditorHarness(page)
  await dispatchShortcut(page, { key: "n", code: "KeyN", ...shiftCommandModifiers })
  await expect(page).toHaveURL(/\/login\?next=%2Fwrite$/)
})
