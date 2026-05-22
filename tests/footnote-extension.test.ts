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
      annotationsOnly: "[@1: simplify]",
      fullText: "==Passage==[@1: simplify][^1: source]",
    })
  })
})
