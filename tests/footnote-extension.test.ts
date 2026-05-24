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
    "El siguiente bloque contiene anotaciones del usuario sobre su documento. Cada anotacion usa el formato `[@N: contenido]`. Si una anotacion va precedida por una cita entre comillas, esa cita indica el pasaje del documento al que se refiere. Las anotaciones no forman parte del documento original; tratalas como instrucciones u observaciones del autor."
  const fullTextPrefix =
    "El siguiente texto fue producido por el usuario. Encontraras anotaciones del usuario marcadas con `[@N: contenido]`, donde N es el numero de la anotacion y contenido es el comentario del usuario sobre ese pasaje especifico. Estas anotaciones no forman parte del documento original; tenlas en cuenta al procesar el documento."

  it("normalizes references and keeps definitions aligned", () => {
    const markdown = "Body[^3] and more[^1]\n\n[^1]: First\n[^3]: Third"

    expect(normalizeMarkdownFootnotes(markdown)).toBe(
      "Body[^1: Third] and more[^2: First]",
    )
  })

  it("appends a new footnote with sequential index", () => {
    const markdown = "Text[^1: Existing]"

    expect(appendMarkdownFootnote(markdown, "New note")).toBe(
      "Text[^1: Existing][^2: New note]",
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
    const markdown = "Body[^1: First][^2: Second]"
    const updated = updateMarkdownFootnote(markdown, 2, "Updated second")

    expect(updated).toBe("Body[^1: First][^2: Updated second]")

    expect(removeMarkdownFootnote(updated, 1)).toBe("Body[^1: Updated second]")
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
