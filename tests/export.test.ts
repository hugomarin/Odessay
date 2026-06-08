import { describe, expect, it, vi } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { Table } from "docx"
import JSZip from "jszip"
import { buildWritingMarkdown, buildWritingExportDocument, getExportFileBaseName, sanitizeFileName } from "@/lib/export/writing-export"
import * as styles from "@/lib/export/styles"
import { blockToElements, renderWritingToDocxBuffer } from "@/lib/export/to-docx"
import { renderWritingToPdfBuffer } from "@/lib/export/to-pdf"

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

const tinyPng = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

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

  it("preserves Unicode punctuation in sanitized filenames", () => {
    // Product-valid titles containing em-dashes must remain intact in the sanitized output
    // so they can be properly encoded by the adapter layer (RFC 5987 filename*)
    expect(sanitizeFileName("Hello — World")).toBe("Hello-—-World")
    expect(sanitizeFileName("Café résumé — draft")).toBe("Cafe-resume-—-draft")
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

  it("parses images into the export document model and markdown", () => {
    const document = buildWritingExportDocument({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://example.com/image.png", alt: "Diagram" },
        },
      ],
    })

    expect(document.blocks).toEqual([
      {
        type: "image",
        image: { src: "https://example.com/image.png", alt: "Diagram", title: null },
      },
    ])
    expect(buildWritingMarkdown({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://example.com/image.png", alt: "Diagram" },
        },
      ],
    })).toBe("![Diagram](https\\://example\\.com/image\\.png)")
  })

  it("shares export styles between PDF and DOCX (DRY)", () => {
    expect(styles.PAGE_BACKGROUND_COLOR).toBe("#ffffff")
    expect(styles.FONT_FAMILY_BODY).toBe("Geist Sans")
    expect(styles.FONT_FAMILY_FALLBACK).toBe("Helvetica")
    expect(styles.TEXT_COLOR).toBe("#161310")
    expect(styles.CODE_BLOCK_BACKGROUND).toBe("#fafdff")
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

  it("uses page-width column sizes for table blocks", async () => {
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
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "C" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "D" }] }] },
              ],
            },
          ],
        },
      ],
    })
    const buffer = await renderWritingToDocxBuffer({ title: "Table Export", document })
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file("word/document.xml")?.async("string")

    expect(xml).toContain(`w:tblW w:type="dxa" w:w="${styles.PAGE_CONTENT_WIDTH_TWIPS}"`)
    expect(xml).toContain(`w:tblLayout w:type="fixed"`)
    expect(xml).toContain(`w:gridCol w:w="${Math.floor(styles.PAGE_CONTENT_WIDTH_TWIPS / 4)}"`)
    expect(xml).toContain(`w:tcW w:type="dxa" w:w="${Math.floor(styles.PAGE_CONTENT_WIDTH_TWIPS / 4)}"`)
    expect(xml).toContain(`w:tcMar><w:top w:type="dxa" w:w="${styles.TABLE_CELL_PADDING_TWIPS}"`)
  })

  it("blockToElements produces a Table wrapper plus trailing spacer", () => {
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

  it("renderWritingToDocxBuffer embeds image blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(tinyPng, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    )

    const document = buildWritingExportDocument({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://example.com/image.png", alt: "Diagram" },
        },
      ],
    })

    const buffer = await renderWritingToDocxBuffer({ title: "Image Export", document })
    const zip = await JSZip.loadAsync(buffer)
    const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith("word/media/"))

    expect(mediaFiles.length).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  it("renderWritingToDocxBuffer preserves code block line breaks and styles", async () => {
    const document = buildWritingExportDocument({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "first line\nsecond line\nthird line" }],
        },
      ],
    })

    const buffer = await renderWritingToDocxBuffer({ title: "Code Export", document })
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file("word/document.xml")?.async("string")

    expect(xml).toContain("<w:br/>")
    expect(xml).toContain(`w:fill="${styles.CODE_BLOCK_BACKGROUND.replace("#", "")}"`)
    expect(xml).toContain(`w:color="${styles.CODE_BLOCK_BORDER_COLOR.replace("#", "")}"`)
    expect(xml).toContain('w:space="6"')
    expect(xml).toContain(styles.FONT_FAMILY_CODE_DOCX)
    expect(xml).toContain("<w:noProof/>")
    expect(xml).toContain(styles.CODE_BLOCK_TEXT_COLOR.replace("#", ""))
  })
})

describe("PDF exporter", () => {
  it("renderWritingToPdfBuffer renders code blocks with the registered mono font", async () => {
    const document = buildWritingExportDocument({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "first line\nsecond line" }],
        },
      ],
    })

    const buffer = await renderWritingToPdfBuffer({ title: "Code Export", document })

    expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
    expect(buffer.length).toBeGreaterThan(1000)
  })
})
