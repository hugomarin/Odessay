import { describe, expect, it } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { buildWritingMarkdown, getExportFileBaseName, sanitizeFileName } from "@/lib/export/writing-export"

const sampleBody: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "A " },
        { type: "text", text: "note", marks: [{ type: "italic" }] },
        { type: "text", text: " with " },
        { type: "footnoteReference", attrs: { index: 2, text: "Footnote text" } },
      ],
    },
    {
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted line" }] }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
        },
      ],
    },
  ],
}

describe("export helpers", () => {
  it("serializes a writing body to markdown", () => {
    expect(buildWritingMarkdown(sampleBody)).toContain("# **Hello**")
    expect(buildWritingMarkdown(sampleBody)).toContain("A *note* with [^2]")
    expect(buildWritingMarkdown(sampleBody)).toContain("> Quoted line")
    expect(buildWritingMarkdown(sampleBody)).toContain("- First")
    expect(buildWritingMarkdown(sampleBody)).toContain("[^2]: Footnote text")
  })

  it("builds a stable filename from title, body text, or id", () => {
    expect(
      getExportFileBaseName({
        title: "A title with / slashes",
        bodyText: "fallback body",
        writingId: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toBe("A-title-with-slashes")

    expect(
      getExportFileBaseName({
        title: null,
        bodyText: "One two three four five six seven",
        writingId: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toBe("One-two-three-four-five")

    expect(
      getExportFileBaseName({
        title: null,
        bodyText: null,
        writingId: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toBe("123e4567")
  })

  it("sanitizes filenames", () => {
    expect(sanitizeFileName("Hello / world: draft")).toBe("Hello-world-draft")
  })
})

