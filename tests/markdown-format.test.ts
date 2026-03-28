import { describe, expect, it } from "vitest"
import {
  convertHtmlTablesToMarkdown,
  materializeMarkdownForRichParser,
  normalizeMarkdownForRoundTrip,
  normalizeMarkdownHighlights,
  renderMarkdownSemanticHtml,
  toggleMarkdownInlineMarker,
} from "@/lib/editor/markdown-format"

describe("toggleMarkdownInlineMarker", () => {
  it("wraps a plain selection", () => {
    const result = toggleMarkdownInlineMarker("Alpha Beta", 0, 5, "**")
    expect(result).toEqual({
      markdown: "**Alpha** Beta",
      selectionStart: 2,
      selectionEnd: 7,
    })
  })

  it("unwraps when the selected text already includes markers", () => {
    const result = toggleMarkdownInlineMarker("**Alpha** Beta", 0, 9, "**")
    expect(result).toEqual({
      markdown: "Alpha Beta",
      selectionStart: 0,
      selectionEnd: 5,
    })
  })

  it("unwraps outer markers when the selection is inside them", () => {
    const markdown = "**Según Altman**"
    const start = markdown.indexOf("Según")
    const end = start + "Según Altman".length
    const result = toggleMarkdownInlineMarker(markdown, start, end, "**")

    expect(result).toEqual({
      markdown: "Según Altman",
      selectionStart: 0,
      selectionEnd: "Según Altman".length,
    })
  })

  it("inserts paired markers for empty selection", () => {
    const result = toggleMarkdownInlineMarker("Alpha", 5, 5, "==")
    expect(result).toEqual({
      markdown: "Alpha====",
      selectionStart: 7,
      selectionEnd: 7,
    })
  })
})

describe("normalizeMarkdownHighlights", () => {
  it("converts html mark tags into canonical markdown", () => {
    expect(normalizeMarkdownHighlights("Alpha <mark>Beta</mark>")).toBe("Alpha ==Beta==")
  })
})

describe("normalizeMarkdownForRoundTrip", () => {
  it("normalizes mark tags and keeps footnote references/definitions consistent", () => {
    const markdown = "Body <mark>highlight</mark>[^3] and more[^1]\n\n[^1]: First\n[^3]: Third"

    expect(normalizeMarkdownForRoundTrip(markdown)).toBe(
      "Body ==highlight==[^1] and more[^2]\n\n[^1]: Third\n[^2]: First",
    )
  })
})

describe("convertHtmlTablesToMarkdown", () => {
  it("converts html table markup into gfm table and strips style metadata", () => {
    const html = `<table style="min-width: 557px;"><colgroup><col style="min-width: 25px;"><col style="width: 133px;"></colgroup><tbody><tr><td><p><strong>Perfil</strong></p></td><td><p><strong>Objetivo</strong></p></td></tr><tr><td><p>Builder</p></td><td><p>Integrar rapido</p></td></tr></tbody></table>`
    const converted = convertHtmlTablesToMarkdown(html)

    expect(converted).toContain("| **Perfil** | **Objetivo** |")
    expect(converted).toContain("| --- | --- |")
    expect(converted).toContain("| Builder | Integrar rapido |")
    expect(converted).not.toContain("<table")
    expect(converted).not.toContain("style=")
  })
})

describe("materializeMarkdownForRichParser", () => {
  it("converts canonical highlight markdown into mark tags for rich parsing", () => {
    expect(materializeMarkdownForRichParser("Alpha ==Beta==")).toBe("Alpha <mark>Beta</mark>")
  })
})

describe("renderMarkdownSemanticHtml", () => {
  it("keeps markdown styling minimal and accents strong markers plus heading lines", () => {
    const html = renderMarkdownSemanticHtml("# Header\n**bold**\n> quote\n`code`\n```")

    expect(html).toContain('class="od-markdown-heading"')
    expect(html).toContain('class="od-markdown-strong"')
    expect(html).not.toContain('class="od-markdown-heading-1"')
    expect(html).not.toContain('class="od-markdown-blockquote"')
    expect(html).not.toContain('class="od-markdown-inline-code"')
    expect(html).not.toContain('class="od-markdown-code-fence"')
  })
})
