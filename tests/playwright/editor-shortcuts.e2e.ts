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
  const altCommandModifiers = isMac ? { metaKey: true, altKey: true } : { ctrlKey: true, altKey: true }
  const shiftCommandModifiers = isMac ? { metaKey: true, shiftKey: true } : { ctrlKey: true, shiftKey: true }

  const editor = page.locator(".odessay-editor-content")
  await editor.click()
  await editor.type("Shortcut target")
  await editor.click({ clickCount: 3 })

  await dispatchShortcut(page, { key: "q", code: "KeyQ", ...altCommandModifiers })
  await switchToMarkdown(page)
  let textarea = await markdownTextarea(page)
  await expect(textarea).toHaveValue(/> Shortcut target/)

  await textarea.fill("Paragraph target")
  await textarea.focus()
  await textarea.evaluate((element) => {
    const node = element as HTMLTextAreaElement
    node.setSelectionRange(0, node.value.length)
  })
  await dispatchShortcut(page, { key: "1", code: "Digit1", ...altCommandModifiers })
  await expect(textarea).toHaveValue(/^# Paragraph target$/)
  await dispatchShortcut(page, { key: "2", code: "Digit2", ...altCommandModifiers })
  await expect(textarea).toHaveValue(/^## Paragraph target$/)
  await dispatchShortcut(page, { key: "3", code: "Digit3", ...altCommandModifiers })
  await expect(textarea).toHaveValue(/^### Paragraph target$/)
  await dispatchShortcut(page, { key: "p", code: "KeyP", ...altCommandModifiers })
  await expect(textarea).toHaveValue(/^Paragraph target$/)

  await page.getByRole("button", { name: "Rich" }).click()
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press(isMac ? "Meta+A" : "Control+A")

  await dispatchShortcut(page, { key: "u", code: "KeyU", ...shiftCommandModifiers })
  await expect(page.locator(".odessay-editor-content mark")).toContainText("Paragraph target")
  await dispatchShortcut(page, { key: "u", code: "KeyU", ...shiftCommandModifiers })
  await expect(page.locator(".odessay-editor-content mark")).toHaveCount(0)

  await dispatchShortcut(page, { key: "k", code: "KeyK", ...commandModifiers })
  await expect(page.getByRole("dialog", { name: "Insert link" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Insert link" })).toBeHidden()

  const footnoteModifiers = isMac ? { metaKey: true, ctrlKey: true } : { ctrlKey: true, altKey: true }
  await dispatchShortcut(page, { key: "k", code: "KeyK", ...footnoteModifiers })
  await expect(page.getByRole("dialog", { name: "Insert footnote" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Insert footnote" })).toBeHidden()
})
