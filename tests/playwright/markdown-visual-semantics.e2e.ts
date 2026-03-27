import { expect, test } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown } from "./helpers/editor"

test("markdown mode surfaces semantic hierarchy for headers/strong/quote/code", async ({ page }) => {
  await openEditorHarness(page)
  await switchToMarkdown(page)

  const textarea = await markdownTextarea(page)
  await textarea.fill("# Encabezado\n\nTexto con **fuerza**\n\n> cita gris\n\n`codigo`")

  await expect(page.locator(".od-markdown-heading-1")).toHaveCount(1)
  await expect(page.locator(".od-markdown-strong")).toHaveCount(1)
  await expect(page.locator(".od-markdown-blockquote")).toHaveCount(1)
  await expect(page.locator(".od-markdown-inline-code")).toHaveCount(1)

  const blockquoteBorder = await page
    .locator(".od-markdown-blockquote")
    .evaluate((element) => getComputedStyle(element).borderLeftColor)
  const inlineCodeBackground = await page
    .locator(".od-markdown-inline-code")
    .evaluate((element) => getComputedStyle(element).backgroundColor)

  expect(blockquoteBorder).not.toBe("rgba(0, 0, 0, 0)")
  expect(inlineCodeBackground).not.toBe("rgba(0, 0, 0, 0)")
})
