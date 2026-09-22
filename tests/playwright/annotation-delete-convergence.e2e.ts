import { expect, test } from "@playwright/test"
import {
  markdownTextarea,
  openEditorHarness,
  switchToMarkdown,
  switchToRich,
} from "./helpers/editor"

/**
 * ANN-04/ANN-05 convergence (ODE-552).
 *
 * The sidebar's delete button forks on `isStandalone` into two genuinely
 * different TipTap commands: `deleteAnnotation` (typed — ai/personal/
 * footnote/highlight-with-reference) and `deleteStandaloneHighlight`
 * (a plain highlight with no reference node). Each has been proven via a
 * real sidebar click in isolation (a typed "highlight" in
 * notes-annotation-pipeline.e2e.ts, a standalone highlight in
 * highlight-roundtrip.e2e.ts), but no test drives both in one place and
 * asserts they reach the same final-state shape — leaving the sidebar's
 * classification fork itself unguarded.
 */
test("typed-annotation and standalone-highlight deletes converge to the same final state", async ({ page }) => {
  test.setTimeout(60_000)

  await openEditorHarness(page)
  await switchToMarkdown(page)
  const markdown = await markdownTextarea(page)
  await markdown.fill(
    ["==AI anchor==[@1|ann-ai: AI note]", "==Standalone anchor=="].join("\n\n"),
  )

  await switchToRich(page)
  const editor = page.locator(".odessay-editor-content")
  await expect(editor.locator("mark")).toHaveCount(2)

  await page.getByRole("button", { name: "Notes panel" }).click()
  const notesPanel = page.getByTestId("editor-panel-notes")
  await expect(notesPanel).toBeVisible()
  await expect(notesPanel.getByText("“AI anchor”")).toBeVisible()
  await expect(notesPanel.getByText("“Standalone anchor”")).toBeVisible()

  // Typed path: real click -> deleteAnnotation("ai", ...).
  await notesPanel.getByRole("button", { name: "Delete AI" }).click({ force: true })
  await expect(notesPanel.getByText("“AI anchor”")).toHaveCount(0)
  await expect(editor).toContainText("AI anchor")
  await expect(editor.locator("mark")).toHaveCount(1)

  // Standalone path: real click -> deleteStandaloneHighlight(...).
  await notesPanel.getByRole("button", { name: "Delete Highlight" }).click({ force: true })
  await expect(notesPanel.getByText("“Standalone anchor”")).toHaveCount(0)
  await expect(editor).toContainText("Standalone anchor")
  await expect(editor.locator("mark")).toHaveCount(0)

  // Convergence: reload and assert both anchors landed in the identical
  // shape of final state — text survives, no mark, regardless of which of
  // the two delete functions removed it.
  const writingId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1)
  expect(writingId).toBeTruthy()
  await page.goto(`/perf/editor-harness/${writingId}`)
  const reloadedEditor = page.locator(".odessay-editor-content")
  await expect(reloadedEditor).toContainText("AI anchor")
  await expect(reloadedEditor).toContainText("Standalone anchor")
  await expect(reloadedEditor.locator("mark")).toHaveCount(0)
})
