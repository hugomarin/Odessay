import { describe, expect, it } from "vitest"
import { appendMarkdownFootnote, normalizeMarkdownFootnotes } from "@/lib/editor/footnote-extension"

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
})
