import { expect, type Locator, type Page } from "@playwright/test"

export async function openEditorHarness(page: Page) {
  await page.goto("/perf/editor-harness")
  const emptyState = page.getByText("No artifacts open.")
  if (await emptyState.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "New Artifact" }).last().click()
  }
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
}

export async function switchToMarkdown(page: Page) {
  await page.getByRole("button", { name: "Markdown" }).click()
  await expect(page.getByLabel("Markdown source")).toBeVisible()
}

export async function switchToRich(page: Page) {
  await page.getByRole("button", { name: "Rich" }).click()
  await expect(page.locator(".odessay-editor-content")).toBeVisible()
}

export async function markdownTextarea(page: Page): Promise<Locator> {
  const field = page.getByLabel("Markdown source")
  await expect(field).toBeVisible()
  return field
}

export async function focusRichEditor(page: Page) {
  const editor = page.locator(".odessay-editor-content")
  await expect(editor).toBeVisible()
  await editor.click()
}

export async function typeInRichEditor(page: Page, text: string) {
  const editor = page.locator(".odessay-editor-content")
  await expect(editor).toBeVisible()
  await editor.click()
  await editor.type(text)
}
