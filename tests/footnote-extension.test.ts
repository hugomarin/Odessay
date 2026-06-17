import { describe, expect, it } from "vitest"
import {
  appendMarkdownFootnote,
  buildAiAnnotationCopy,
  getMarkdownFootnotes,
  normalizeMarkdownFootnotes,
  removeMarkdownFootnote,
  updateMarkdownFootnote,
} from "@/lib/editor/footnote-extension"

describe("footnote extension helpers", () => {
  const annotationsOnlyPrefix =
    "El siguiente bloque contiene instrucciones del usuario sobre su documento. Cada linea sigue el formato: cita del pasaje relevante seguida de la instruccion entre corchetes. Tratalas como directivas del autor sobre ese fragmento especifico."
  const fullTextPrefix =
    "<!-- Anotaciones del autor embebidas en el texto. Formato: ==texto citado==[@N: instrucción] — el fragmento entre == es el pasaje al que refiere la instrucción entre corchetes. Son directivas del autor para ti; no forman parte del documento publicable. Tenlas en cuenta al procesar el texto. -->"

  it("normalizes references and keeps definitions aligned", () => {
    const markdown = "Body[^3] and more[^1]\n\n[^1]: First\n[^3]: Third"

    expect(normalizeMarkdownFootnotes(markdown)).toBe(
      "Body[^1: Third] and more[^2: First]",
    )
  })

  it("appends a new footnote with sequential index", () => {
    const markdown = "Text[^1: Existing]"

    expect(appendMarkdownFootnote(markdown, "New note")).toMatch(
      /^Text\[\^1: Existing\]\[\^2\|[^\]:|]+: New note\]$/,
    )
  })

  it("returns ordered footnotes from markdown", () => {
    const markdown = "Body[@1: AI note][^2: Second][@p1: Personal note][^1: First]"

    expect(getMarkdownFootnotes(markdown)).toEqual([
      { type: "ai", index: 1, text: "AI note" },
      { type: "footnote", index: 1, text: "Second" },
      { type: "personal", index: 1, text: "Personal note" },
      { type: "footnote", index: 2, text: "First" },
    ])
  })

  it("updates and removes footnotes while keeping numbering consistent", () => {
    const markdown = "Body[^1|ann-a: First][^2|ann-b: Second]"
    const updated = updateMarkdownFootnote(markdown, 2, "Updated second")

    expect(updated).toBe("Body[^1|ann-a: First][^2|ann-b: Updated second]")

    expect(removeMarkdownFootnote(updated, 1)).toBe("Body[^1|ann-b: Updated second]")
  })

  it("preserves inline annotation ids while renumbering by type", () => {
    const markdown = "Body[@3|ai-a: third][@1|ai-b: first][@p2|p-a: personal][^7|fn-a: note]"

    expect(normalizeMarkdownFootnotes(markdown)).toBe(
      "Body[@1|ai-a: third][@2|ai-b: first][@p1|p-a: personal][^1|fn-a: note]",
    )
  })

  it("builds AI copy that strips personal and collaborative annotations", () => {
    const markdown = "==Passage==[@1: simplify][@p1: for later][@c1: share with team][^1: source]"

    expect(buildAiAnnotationCopy(markdown)).toEqual({
      annotationsOnly: `${annotationsOnlyPrefix}\n\n"Passage" [@1: simplify]`,
      fullText: `${fullTextPrefix}\n\n==Passage==[@1: simplify][^1: source]`,
    })
  })

  it("includes cited text for AI annotations with anchor, omits it when no highlight precedes", () => {
    const markdown = "Intro[@1: check this] ==Highlighted==[@2: expand][@p2: personal note]"

    expect(buildAiAnnotationCopy(markdown)).toEqual({
      annotationsOnly:
        `${annotationsOnlyPrefix}\n\n[@1: check this]\n"Highlighted" [@2: expand]`,
      fullText: `${fullTextPrefix}\n\nIntro[@1: check this] ==Highlighted==[@2: expand]`,
    })
  })
})
