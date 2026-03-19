import { describe, expect, it } from "vitest"
import {
  appendMarkdownFootnote,
  getMarkdownFootnotes,
  normalizeMarkdownFootnotes,
  removeMarkdownFootnote,
  updateMarkdownFootnote,
} from "@/lib/editor/footnote-extension"

describe("footnote extension helpers", () => {
  it("normalizes references and keeps definitions aligned", () => {
    const markdown = "Body[^3] and more[^1]\n\n[^1]: First\n[^3]: Third"

    expect(normalizeMarkdownFootnotes(markdown)).toBe(
      "Body[^1] and more[^2]\n\n[^1]: Third\n[^2]: First",
    )
  })

  it("appends a new footnote with sequential index", () => {
    const markdown = "Text[^1]\n\n[^1]: Existing"

    expect(appendMarkdownFootnote(markdown, "New note")).toBe(
      "Text[^1][^2]\n\n[^1]: Existing\n[^2]: New note",
    )
  })

  it("returns ordered footnotes from markdown", () => {
    const markdown = "Body[^2] and more[^1]\n\n[^1]: First\n[^2]: Second"

    expect(getMarkdownFootnotes(markdown)).toEqual([
      { index: 1, text: "Second" },
      { index: 2, text: "First" },
    ])
  })

  it("updates and removes footnotes while keeping numbering consistent", () => {
    const markdown = "Body[^1][^2]\n\n[^1]: First\n[^2]: Second"
    const updated = updateMarkdownFootnote(markdown, 2, "Updated second")

    expect(updated).toBe("Body[^1][^2]\n\n[^1]: First\n[^2]: Updated second")

    expect(removeMarkdownFootnote(updated, 1)).toBe("Body[^1]\n\n[^1]: Updated second")
  })
})
