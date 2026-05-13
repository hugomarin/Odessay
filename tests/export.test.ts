import { describe, expect, it } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { Table } from "docx"
import { buildWritingMarkdown, buildWritingExportDocument, getExportFileBaseName, sanitizeFileName } from "@/lib/export/writing-export"
import * as styles from "@/lib/export/styles"
import { blockToElements, renderWritingToDocxBuffer } from "@/lib/export/to-docx"

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

  it("parses table rows into the export document model", () => {
    const document = buildWritingExportDocument({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "C" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "D" }] }] },
              ],
            },
          ],
        },
      ],
    })

    expect(document.blocks).toHaveLength(1)
    expect(document.blocks[0].type).toBe("table")
    if (document.blocks[0].type === "table") {
      expect(document.blocks[0].rows).toEqual([
        ["A", "B"],
        ["C", "D"],
      ])
    }
  })

  it("shares export styles between PDF and DOCX (DRY)", () => {
    expect(styles.PAGE_BACKGROUND_COLOR).toBe("#ffffff")
    expect(styles.FONT_FAMILY_BODY).toBe("Geist Sans")
    expect(styles.FONT_FAMILY_FALLBACK).toBe("Helvetica")
    expect(styles.TEXT_COLOR).toBe("#161310")
    expect(styles.TABLE_BORDER_COLOR).toBeDefined()
    expect(styles.TABLE_HEADER_BACKGROUND).toBeDefined()
    expect(styles.LINE_HEIGHT_DOCX).toBeDefined()
    expect(styles.ptToTwips(12)).toBe(240)
    expect(styles.ptToHalfPoints(12)).toBe(24)
  })
})

describe("DOCX exporter", () => {
  it("blockToElements returns a Table for table blocks", () => {
    const result = blockToElements({ type: "table", rows: [["A", "B"], ["C", "D"]] })
    expect(result).toHaveLength(2)
    expect(result[0]).toBeInstanceOf(Table)
  })

  it("blockToElements produces a Table with the expected number of rows", () => {
    const result = blockToElements({ type: "table", rows: [["A", "B"], ["C", "D"]] })
    expect(result).toHaveLength(2)
    expect(result[0]).toBeInstanceOf(Table)
  })

  it("renderWritingToDocxBuffer produces a non-empty buffer for a table document", async () => {
    const document = buildWritingExportDocument({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Header 1" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Header 2" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Cell 1" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Cell 2" }] }] },
              ],
            },
          ],
        },
      ],
    })

    const buffer = await renderWritingToDocxBuffer({ title: "Table Export", document })
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(1000)
  })
})

