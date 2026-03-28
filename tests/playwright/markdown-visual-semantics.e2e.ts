import { expect, test } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown } from "./helpers/editor"

const toWeightNumber = (value: string): number => {
  const normalized = value.trim().toLowerCase()

  if (normalized === "normal") {
    return 400
  }

  if (normalized === "bold") {
    return 700
  }

  return Number.parseInt(normalized, 10)
}

test("markdown mode keeps a plain monospace surface and bolds #/##/### plus strong spans", async ({ page }) => {
  await openEditorHarness(page)
  await switchToMarkdown(page)

  const textarea = await markdownTextarea(page)
  await textarea.fill("# Encabezado\n## Subtitulo\n### Seccion\n\nTexto con **fuerza**\n\n> cita gris\n\n`codigo`")

  await expect(page.locator(".od-markdown-heading")).toHaveCount(3)
  await expect(page.locator(".od-markdown-strong")).toHaveCount(1)
  await expect(page.locator(".od-markdown-heading-1")).toHaveCount(0)
  await expect(page.locator(".od-markdown-blockquote")).toHaveCount(0)
  await expect(page.locator(".od-markdown-inline-code")).toHaveCount(0)

  const [sourceFontFamily, sourceFontSize, semanticFontFamily, semanticFontSize, baseWeight, strongWeight, headingWeight] =
    await Promise.all([
      textarea.evaluate((element) => getComputedStyle(element).fontFamily),
      textarea.evaluate((element) => getComputedStyle(element).fontSize),
      page.locator(".odessay-markdown-semantic").evaluate((element) => getComputedStyle(element).fontFamily),
      page.locator(".odessay-markdown-semantic").evaluate((element) => getComputedStyle(element).fontSize),
      page.locator(".odessay-markdown-semantic").evaluate((element) => getComputedStyle(element).fontWeight),
      page.locator(".od-markdown-strong").evaluate((element) => getComputedStyle(element).fontWeight),
      page.locator(".od-markdown-heading").first().evaluate((element) => getComputedStyle(element).fontWeight),
    ])

  expect(sourceFontFamily.toLowerCase()).toContain("monospace")
  expect(semanticFontFamily.toLowerCase()).toContain("monospace")
  expect(sourceFontSize).toBe(semanticFontSize)
  expect(toWeightNumber(headingWeight)).toBeGreaterThan(toWeightNumber(baseWeight))
  expect(toWeightNumber(strongWeight)).toBeGreaterThan(toWeightNumber(baseWeight))

  await expect(textarea).toHaveAttribute("spellcheck", "false")
})
