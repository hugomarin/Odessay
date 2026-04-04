import { expect, test, type Page } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown, switchToRich, typeInRichEditor } from "./helpers/editor"

const SHORTCUT_MODIFIER = process.platform === "darwin" ? "Meta" : "Control"

async function resetRichContent(page: Page, text: string) {
  await switchToMarkdown(page)
  const textarea = await markdownTextarea(page)
  await textarea.fill(text)
  await switchToRich(page)
}

async function selectSubstringInRichParagraph(
  page: Page,
  fullText: string,
  selectedText: string,
) {
  await page.locator(".odessay-editor-content").evaluate(
    (root: Element, payload: { fullText: string; selectedText: string }) => {
      const container = root as HTMLElement
      const paragraph = container.querySelector("p")
      const textNode = paragraph?.firstChild

      if (!paragraph || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
        throw new Error("Unable to find rich editor paragraph text node.")
      }

      const source = textNode.textContent ?? ""
      if (source !== payload.fullText) {
        throw new Error(`Unexpected paragraph content: "${source}"`)
      }

      const start = source.indexOf(payload.selectedText)
      if (start === -1) {
        throw new Error(`Unable to find substring "${payload.selectedText}" in paragraph text.`)
      }

      const selection = window.getSelection()
      if (!selection) {
        throw new Error("Unable to access window selection.")
      }

      const range = document.createRange()
      range.setStart(textNode, start)
      range.setEnd(textNode, start + payload.selectedText.length)
      selection.removeAllRanges()
      selection.addRange(range)
    },
    { fullText, selectedText },
  )
}

test("bold formatting stays bounded to the selected rich-text range via toolbar and shortcut", async ({ page }) => {
  const baseSentence = "Alpha Beta Gamma"
  const selectedWord = "Beta"

  await openEditorHarness(page)
  await typeInRichEditor(page, baseSentence)

  for (let iteration = 0; iteration < 6; iteration += 1) {
    await resetRichContent(page, baseSentence)
    await selectSubstringInRichParagraph(page, baseSentence, selectedWord)

    if (iteration % 2 === 0) {
      await page.locator("#editor-action-bold").click()
    } else {
      await page.keyboard.press(`${SHORTCUT_MODIFIER}+b`)
    }

    await switchToMarkdown(page)
    const textarea = await markdownTextarea(page)
    await expect(textarea).toHaveValue(new RegExp(`Alpha \\*\\*${selectedWord}\\*\\* Gamma`))
    await expect(textarea).not.toHaveValue(new RegExp(`\\*\\*${selectedWord} Gamma\\*\\*`))
  }
})
