import { expect, test } from "@playwright/test"
import {
  markdownTextarea,
  openEditorHarness,
  switchToMarkdown,
  switchToRich,
} from "./helpers/editor"

test("Notes keeps one annotation pipeline across Markdown and Rich modes", async ({ page }) => {
  test.setTimeout(60_000)

  await page.route("**/api/writings/**", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: null, error: null }),
      })
      return
    }
    await route.continue()
  })

  await openEditorHarness(page)
  await switchToMarkdown(page)
  const markdown = await markdownTextarea(page)
  await markdown.fill([
    "==AI anchor==[@1|ann-ai: AI original]",
    "==Personal anchor==[@p1|ann-personal: Personal original]",
    "==Footnote anchor==[^1|ann-footnote: Footnote original]",
    "==Highlight anchor==[@h1|ann-highlight: Highlight original]",
    "==Standalone anchor==",
  ].join("\n\n"))

  await page.getByRole("button", { name: "Notes panel" }).click()
  const notesPanel = page.getByTestId("editor-panel-notes")
  await expect(notesPanel).toBeVisible()

  for (const anchor of ["AI anchor", "Personal anchor", "Footnote anchor", "Highlight anchor", "Standalone anchor"]) {
    await expect(notesPanel.getByText(`“${anchor}”`)).toBeVisible()
  }
  await page.screenshot({ path: "output/playwright/ode-383/markdown-notes.png" })

  const aiCard = notesPanel.getByText("“AI anchor”", { exact: true }).locator("..")
  await aiCard.locator("textarea").fill("AI updated in Markdown")
  await aiCard.locator("textarea").press("Tab")
  await expect(markdown).toHaveValue(/\[@1\|ann-ai: AI updated in Markdown\]/)

  await aiCard.locator("button").filter({ hasText: "AI" }).click()
  await aiCard.getByRole("button", { name: "Personal" }).click()
  await expect(markdown).toHaveValue(/\[@p1\|ann-ai: AI updated in Markdown\]/)

  const footnoteCard = notesPanel.getByText("“Footnote anchor”", { exact: true }).locator("..")
  await footnoteCard.getByRole("button", { name: "Go to annotation in artifact" }).click({ force: true })
  const selection = await markdown.evaluate((element) => {
    const field = element as HTMLTextAreaElement
    return field.value.slice(field.selectionStart, field.selectionEnd)
  })
  expect(selection).toContain("ann-footnote")

  const highlightCard = notesPanel.getByText("“Highlight anchor”", { exact: true }).locator("..")
  await highlightCard.getByRole("button", { name: "Delete Highlight" }).click({ force: true })
  await expect(markdown).not.toHaveValue(/ann-highlight/)
  await expect(markdown).toHaveValue(/==Highlight anchor==/)

  await switchToRich(page)
  await expect(page.locator(".odessay-editor-content")).toContainText("AI anchor")
  await expect(notesPanel.getByText("AI updated in Markdown")).toBeVisible()
  await expect(aiCard.locator("button").filter({ hasText: "Personal" })).toBeVisible()
  await expect(notesPanel.getByText("“Standalone anchor”")).toBeVisible()
  await page.screenshot({ path: "output/playwright/ode-383/rich-notes.png" })
})
