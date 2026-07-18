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
  await page.getByRole("button", { name: "Mark passage" }).click()

  await switchToMarkdown(page)
  const textarea = await markdownTextarea(page)
  await expect(textarea).toHaveValue(/==Highlight==/)

  await textarea.fill("==Highlight updated==")
  await switchToRich(page)
  await expect(page.locator(".odessay-editor-content mark")).toContainText("Highlight updated")
})

/**
 * @contract Notes panel mutation lifecycle
 * @doc workflow/context/features/odessay-editor.md §Notes panel
 * @service DocumentService.save()
 */
test("standalone highlight can be navigated to and deleted persistently from Notes", async ({ page }) => {
  test.setTimeout(60_000)
  await openEditorHarness(page)
  await switchToMarkdown(page)
  const markdown = await markdownTextarea(page)
  await markdown.fill(`${"paper quiet river ".repeat(900).trim()}\n\n==Target anchor==`)
  await switchToRich(page)
  const editor = page.locator(".odessay-editor-content")
  await expect(editor.locator("mark")).toContainText("Target anchor")

  await page.getByRole("button", { name: "Notes panel" }).click()
  const notesPanel = page.getByTestId("editor-panel-notes")
  await expect(notesPanel).toBeVisible()
  await expect(notesPanel.getByText("“Target anchor”")).toBeVisible()

  await page.getByTestId("editor-writing-area").evaluate((element) => {
    element.scrollTop = 0
  })
  await notesPanel.getByRole("button", { name: "Go to annotation in document" }).click({ force: true })

  const topbarBox = await page.getByTestId("editor-topbar").boundingBox()
  const statusbarBox = await page.getByTestId("editor-statusbar").boundingBox()
  expect(topbarBox).not.toBeNull()
  expect(statusbarBox).not.toBeNull()
  await expect.poll(async () => {
    const box = await editor.locator("mark").boundingBox()
    return box
      ? {
          belowTopbar: box.y >= topbarBox!.y + topbarBox!.height + 8,
          aboveStatusbar: box.y + box.height <= statusbarBox!.y - 8,
        }
      : null
  }).toEqual({ belowTopbar: true, aboveStatusbar: true })
  const targetBox = await editor.locator("mark").boundingBox()
  expect(targetBox).not.toBeNull()
  expect(targetBox!.y).toBeGreaterThanOrEqual(topbarBox!.y + topbarBox!.height + 8)
  expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(statusbarBox!.y - 8)
  await page.screenshot({ path: "artifacts/ode-378/navigate-visible.png" })

  await notesPanel.getByRole("button", { name: "Delete Highlight" }).click({ force: true })
  await expect(editor.locator("mark")).toHaveCount(0)
  await expect(notesPanel.getByText("“Target anchor”")).toHaveCount(0)
  await page.screenshot({ path: "artifacts/ode-378/delete-complete.png" })

  const writingId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1)
  expect(writingId).toBeTruthy()
  await page.goto(`/perf/editor-harness/${writingId}`)
  await expect(page.locator(".odessay-editor-content")).toContainText("Target anchor")
  await expect(page.locator(".odessay-editor-content mark")).toHaveCount(0)
})
