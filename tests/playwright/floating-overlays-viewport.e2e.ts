import { mkdir } from "node:fs/promises"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown, switchToRich } from "./helpers/editor"

const EVIDENCE_DIR = process.env.ODE385_EVIDENCE_DIR

async function screenshot(page: Page, filename: string) {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: `${EVIDENCE_DIR}/${filename}`, fullPage: false })
}

async function expectInsideViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (!box || !viewport) return

  expect(box.x).toBeGreaterThanOrEqual(8)
  expect(box.y).toBeGreaterThanOrEqual(54)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 8)
}

async function selectEdgeWord(paragraph: Locator, edge: "left" | "right") {
  await paragraph.evaluate((element, requestedEdge) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const candidates: Array<{ node: Text; start: number; end: number; center: number }> = []

    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const text = node.textContent ?? ""
      for (const match of text.matchAll(/\S+/g)) {
        const start = match.index
        const end = start + match[0].length
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)
        const rect = range.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          candidates.push({ node, start, end, center: rect.left + rect.width / 2 })
        }
      }
    }

    candidates.sort((a, b) => a.center - b.center)
    const target = requestedEdge === "left" ? candidates[0] : candidates.at(-1)
    if (!target) throw new Error("No visible word available for selection.")

    const range = document.createRange()
    range.setStart(target.node, target.start)
    range.setEnd(target.node, target.end)
    const selection = window.getSelection()
    if (!selection) throw new Error("Window selection is unavailable.")
    selection.removeAllRanges()
    selection.addRange(range)
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  }, edge)
}

test.describe("floating selection overlays stay inside the viewport", () => {
  test.use({ viewport: { width: 760, height: 360 } })

  test("editor flips the annotation bubble above a selection near the bottom", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 360 })
    await openEditorHarness(page)
    await switchToMarkdown(page)
    const markdown = await markdownTextarea(page)
    await markdown.fill(Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1} ends here.`).join("\n\n"))
    await switchToRich(page)

    const lastParagraph = page.locator(".odessay-editor-content p").last()
    await lastParagraph.evaluate((element) => element.scrollIntoView({ block: "end" }))
    await lastParagraph.click()
    await page.keyboard.press("End")
    await page.keyboard.press("Shift+ControlOrMeta+ArrowLeft")

    const popup = page.getByTestId("selection-popup")
    await expect(popup).toBeVisible()
    await expectInsideViewport(popup, page)
    await popup.getByRole("button", { name: "Annotate passage" }).click()

    const bubble = page.getByTestId("annotation-bubble")
    await expect(bubble).toBeVisible()
    await expect(bubble).toHaveAttribute("data-placement", "above")
    await expectInsideViewport(bubble, page)
    await screenshot(page, "editor-bottom-flip.png")
  })

  test("reading bubble flips at the bottom and clamps at both horizontal edges", async ({ page }) => {
    await page.goto("/perf/reading-harness")
    const paragraphs = page.locator("#reading-text .prose-odessay p")
    const lastParagraph = paragraphs.last()
    await lastParagraph.evaluate((element) => element.scrollIntoView({ block: "end" }))
    await selectEdgeWord(lastParagraph, "right")

    const popup = page.getByTestId("selection-popup")
    await expect(popup).toBeVisible()
    await popup.getByRole("button", { name: "Annotate passage" }).click()
    const bubble = page.getByTestId("annotation-bubble")
    await expect(bubble).toBeVisible()
    await expect(bubble).toHaveAttribute("data-placement", "above")
    await expectInsideViewport(bubble, page)
    await screenshot(page, "reading-bottom-right-clamp.png")

    await page.getByRole("button", { name: "Cancel" }).click()
    const firstParagraph = paragraphs.first()
    await firstParagraph.evaluate((element) => element.scrollIntoView({ block: "start" }))
    await selectEdgeWord(firstParagraph, "left")
    await expect(popup).toBeVisible()
    await popup.getByRole("button", { name: "Annotate passage" }).click()
    await expect(bubble).toBeVisible()
    await expectInsideViewport(bubble, page)
    const box = await bubble.boundingBox()
    expect(box?.x).toBe(8)
    await screenshot(page, "reading-left-clamp.png")
  })
})
