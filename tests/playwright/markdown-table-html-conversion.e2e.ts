import { expect, test } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown } from "./helpers/editor"

test("markdown mode converts pasted html tables into style-free gfm tables", async ({ page }) => {
  await openEditorHarness(page)
  await switchToMarkdown(page)

  const textarea = await markdownTextarea(page)
  await textarea.fill(
    `<table style="min-width: 557px;"><colgroup><col style="min-width: 25px;"><col style="width: 133px;"></colgroup><tbody><tr><td><p><strong>Perfil</strong></p></td><td><p><strong>Objetivo</strong></p></td></tr><tr><td><p>Builder</p></td><td><p>Integrar rapido</p></td></tr></tbody></table>`,
  )

  const value = await textarea.inputValue()
  expect(value).toContain("| **Perfil** | **Objetivo** |")
  expect(value).toContain("| --- | --- |")
  expect(value).toContain("| Builder | Integrar rapido |")
  expect(value).not.toContain("<table")
  expect(value).not.toContain("style=")
})
