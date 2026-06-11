import { expect, test } from "@playwright/test"
import { openEditorHarness, switchToMarkdown, markdownTextarea } from "./helpers/editor"

test.describe("editor selection metrics", () => {
  test("shows full document metrics when no selection in rich mode", async ({ page }) => {
    await openEditorHarness(page)

    const editor = page.locator(".odessay-editor-content")
    await editor.click()
    await editor.type("Hello world. This is Artifact Studio!")

    const metrics = page.getByTestId("editor-statusbar-metrics")
    await expect(metrics).toContainText("words")
    await expect(metrics).toContainText("chars")
    await expect(metrics).toContainText("sentences")
    await expect(metrics).toContainText("min")
    await expect(metrics).toContainText("pg")
    await expect(metrics).not.toContainText("selected")
  })

  test("shows selection metrics when text is selected in rich mode", async ({ page }) => {
    await openEditorHarness(page)

    const editor = page.locator(".odessay-editor-content")
    await editor.click()
    await editor.type("Hello world")

    // Select all text with Cmd+A / Ctrl+A
    await page.keyboard.press("ControlOrMeta+a")

    const metrics = page.getByTestId("editor-statusbar-metrics")
    await expect(metrics).toContainText("selected")
    await expect(metrics).toContainText("2 words")
    await expect(metrics).toContainText("11 chars")
  })

  test("returns to document metrics after deselecting in rich mode", async ({ page }) => {
    await openEditorHarness(page)

    const editor = page.locator(".odessay-editor-content")
    await editor.click()
    await editor.type("Hello world")

    await page.keyboard.press("ControlOrMeta+a")

    const metrics = page.getByTestId("editor-statusbar-metrics")
    await expect(metrics).toContainText("selected")

    // Deselect by moving cursor to end
    await page.keyboard.press("End")
    await expect(metrics).not.toContainText("selected")
    await expect(metrics).toContainText("words")
  })

  test("shows selection metrics in markdown mode", async ({ page }) => {
    await openEditorHarness(page)
    await switchToMarkdown(page)

    const textarea = await markdownTextarea(page)
    await textarea.fill("Hello world")
    await textarea.focus()

    // Select all text
    await page.keyboard.press("ControlOrMeta+a")

    const metrics = page.getByTestId("editor-statusbar-metrics")
    await expect(metrics).toContainText("selected")
    await expect(metrics).toContainText("2 words")
    await expect(metrics).toContainText("11 chars")
  })

  test("shows document metrics when no selection in markdown mode", async ({ page }) => {
    await openEditorHarness(page)
    await switchToMarkdown(page)

    const textarea = await markdownTextarea(page)
    await textarea.fill("Hello world")
    await textarea.focus()

    // Move cursor to end without selection
    await page.keyboard.press("End")

    const metrics = page.getByTestId("editor-statusbar-metrics")
    await expect(metrics).toContainText("words")
    await expect(metrics).toContainText("chars")
    await expect(metrics).toContainText("sentences")
    await expect(metrics).not.toContainText("selected")
  })
})
