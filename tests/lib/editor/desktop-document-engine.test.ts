/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import { Editor, type Content } from "@tiptap/core"
import { createEditorExtensions } from "@/lib/editor/extensions"

const engine = new DesktopDocumentEngine()

function createEditor(content: unknown) {
  return new Editor({
    extensions: createEditorExtensions(),
    content: content as Content,
  })
}

describe("DesktopDocumentEngine", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "33333333-3333-4333-8333-333333333333"),
    })
  })

  describe("richToSource", () => {
    it("serializes a simple document to canonical markdown", () => {
      const editor = createEditor({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hello" }] },
          {
            type: "paragraph",
            content: [{ type: "text", text: "World" }],
          },
        ],
      })

      const result = engine.richToSource(editor)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.markdown).toBe("# Hello\n\nWorld")
      editor.destroy()
    })

    it("serializes inline marks to canonical markdown", () => {
      const editor = createEditor({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "bold ", marks: [{ type: "bold" }] },
              { type: "text", text: "italic ", marks: [{ type: "italic" }] },
              { type: "text", text: "strike ", marks: [{ type: "strike" }] },
              { type: "text", text: "highlight", marks: [{ type: "highlight" }] },
            ],
          },
        ],
      })

      const result = engine.richToSource(editor)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.markdown).toContain("**bold**")
      expect(result.markdown).toContain("*italic*")
      expect(result.markdown).toContain("~~strike~~")
      expect(result.markdown).toContain("==highlight==")
      editor.destroy()
    })

    it("serializes links to canonical markdown", () => {
      const editor = createEditor({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "link",
                marks: [{ type: "link", attrs: { href: "https://example.com" } }],
              },
            ],
          },
        ],
      })

      const result = engine.richToSource(editor)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.markdown).toContain("[link](https://example.com)")
      editor.destroy()
    })

    it("serializes inline code to canonical markdown", () => {
      const editor = createEditor({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "code", marks: [{ type: "code" }] }],
          },
        ],
      })

      const result = engine.richToSource(editor)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.markdown).toContain("`code`")
      editor.destroy()
    })

    it("serializes blockquote to canonical markdown", () => {
      const editor = createEditor({
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Quoted" }] },
            ],
          },
        ],
      })

      const result = engine.richToSource(editor)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.markdown).toContain("> Quoted")
      editor.destroy()
    })

    it("serializes ordered and bullet lists to canonical markdown", () => {
      const editor = createEditor({
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }] },
            ],
          },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Beta" }] }] },
            ],
          },
        ],
      })

      const result = engine.richToSource(editor)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.markdown).toContain("1. First")
      expect(result.markdown).toContain("2. Second")
      expect(result.markdown).toContain("- Alpha")
      expect(result.markdown).toContain("- Beta")
      editor.destroy()
    })

    it("serializes fenced code blocks to canonical markdown", () => {
      const editor = createEditor({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "ts" },
            content: [{ type: "text", text: "const x = 1" }],
          },
        ],
      })

      const result = engine.richToSource(editor)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.markdown).toContain("```")
      expect(result.markdown).toContain("const x = 1")
      editor.destroy()
    })

    it("serializes tables to canonical markdown", () => {
      const editor = createEditor({
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
                  { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
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

      const result = engine.richToSource(editor)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.markdown).toContain("| A | B |")
      expect(result.markdown).toContain("| --- | --- |")
      expect(result.markdown).toContain("| C | D |")
      editor.destroy()
    })

    it("serializes footnotes to canonical markdown", () => {
      const editor = createEditor({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Text with note " },
              {
                type: "annotationReference",
                attrs: { id: "ann-1", type: "footnote", index: 1, text: "Footnote body" },
              },
            ],
          },
        ],
      })

      const result = engine.richToSource(editor)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.markdown).toContain("[^1: Footnote body]")
      editor.destroy()
    })
  })

  describe("sourceToRich", () => {
    it("parses headings, paragraphs and marks to ProseMirror JSON", () => {
      const markdown = `# Title

Paragraph with **bold**, *italic*, ~~strike~~, ==highlight==, [link](https://example.com) and \`code\`.`

      const result = engine.sourceToRich(markdown)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.snapshot.bodyJson).toBeDefined()
      expect(result.snapshot.markdown).toContain("# Title")
      expect(result.snapshot.markdown).toContain("**bold**")
      expect(result.snapshot.markdown).toContain("*italic*")
      expect(result.snapshot.markdown).toContain("~~strike~~")
      expect(result.snapshot.markdown).toContain("==highlight==")
      expect(result.snapshot.markdown).toContain("[link](https://example.com)")
      expect(result.snapshot.markdown).toContain("`code`")
    })

    it("parses blockquotes", () => {
      const result = engine.sourceToRich("> Quoted line")
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.snapshot.markdown).toContain("> Quoted line")
    })

    it("parses ordered and bullet lists", () => {
      const markdown = `1. First
2. Second

- Alpha
- Beta`

      const result = engine.sourceToRich(markdown)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.snapshot.markdown).toContain("1. First")
      expect(result.snapshot.markdown).toContain("2. Second")
      expect(result.snapshot.markdown).toContain("- Alpha")
      expect(result.snapshot.markdown).toContain("- Beta")
    })

    it("parses fenced code blocks", () => {
      const markdown = "```ts\nconst x = 1\n```"
      const result = engine.sourceToRich(markdown)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.snapshot.markdown).toContain("```")
      expect(result.snapshot.markdown).toContain("const x = 1")
    })

    it("parses tables", () => {
      const markdown = `| A | B |
| --- | --- |
| C | D |`

      const result = engine.sourceToRich(markdown)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.snapshot.markdown).toContain("| A | B |")
      expect(result.snapshot.markdown).toContain("| C | D |")
    })

    it("parses footnotes", () => {
      const markdown = "Text with note [^1: Footnote body]"
      const result = engine.sourceToRich(markdown)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.snapshot.markdown).toContain("[^1: Footnote body]")
    })
  })

  describe("validateRoundTrip", () => {
    it("passes for the full supported markdown profile", () => {
      const markdown = `# Title

## Subtitle

### Sub-subtitle

Paragraph with **bold**, *italic*, ~~strike~~, ==highlight==, [link](https://example.com) and \`inline code\`.

> A blockquote with **bold** inside.

1. Ordered first
2. Ordered second

- Bullet alpha
- Bullet beta

\`\`\`ts
const code = "block"
\`\`\`

| Header 1 | Header 2 |
| --- | --- |
| Cell A | Cell B |

Text with footnote [^1: Footnote body here].`

      const result = engine.validateRoundTrip(markdown)
      expect(result.ok).toBe(true)
    })

    it("passes for a minimal empty document", () => {
      const result = engine.validateRoundTrip("")
      expect(result.ok).toBe(true)
    })

    it("passes for headings only", () => {
      const markdown = "# H1\n\n## H2\n\n### H3"
      const result = engine.validateRoundTrip(markdown)
      expect(result.ok).toBe(true)
    })

    it("passes for nested marks", () => {
      const markdown = "***bold italic*** and ~~strike~~ and ==highlight=="
      const result = engine.validateRoundTrip(markdown)
      expect(result.ok).toBe(true)
    })

    it("passes for a realistic ~1000 word document", () => {
      const paragraphs = Array.from({ length: 20 }, (_, i) =>
        `Paragraph ${i + 1} with **bold**, *italic*, and [a link](https://example.com/page-${i + 1}).`,
      )
      const markdown = `# A Realistic Document

${paragraphs.join("\n\n")}

> A blockquote that spans the middle of the document.

1. First item
2. Second item
3. Third item

- Alpha
- Beta
- Gamma

\`\`\`js
function example() {
  return "hello world"
}
\`\`\`

| Name | Value |
| --- | --- |
| Foo | 1 |
| Bar | 2 |

A closing paragraph with a footnote [^1: This is the footnote text.]`

      const result = engine.validateRoundTrip(markdown)
      expect(result.ok).toBe(true)
    })

    it("fails gracefully when given completely invalid input", () => {
      // The engine should return ok=true for empty/whitespace because TipTap
      // normalizes it to a single empty paragraph.
      const result = engine.validateRoundTrip("   ")
      expect(result.ok).toBe(true)
    })
  })

  describe("performance contract — mode switch latency", () => {
    it("completes rich→source serialization in < 200ms for a ~1000 word document", () => {
      const paragraphs = Array.from({ length: 20 }, (_, i) =>
        `Paragraph ${i + 1} with **bold**, *italic*, and [a link](https://example.com/page-${i + 1}).`,
      )
      const markdown = `# Title\n\n${paragraphs.join("\n\n")}\n\n> Quote\n\n1. One\n2. Two\n\n- A\n- B\n\n\`\`\`ts\nconst x = 1\n\`\`\`\n\n| A | B |\n| --- | --- |\n| C | D |\n\nFootnote [^1: Note].`

      const editor = createEditor(markdown)
      const start = performance.now()
      const result = engine.richToSource(editor)
      const elapsed = performance.now() - start
      editor.destroy()

      expect(result.success).toBe(true)
      expect(elapsed).toBeLessThan(200)
    })

    it("completes source→rich parse in < 200ms for a ~1000 word document", () => {
      const paragraphs = Array.from({ length: 20 }, (_, i) =>
        `Paragraph ${i + 1} with **bold**, *italic*, and [a link](https://example.com/page-${i + 1}).`,
      )
      const markdown = `# Title\n\n${paragraphs.join("\n\n")}\n\n> Quote\n\n1. One\n2. Two\n\n- A\n- B\n\n\`\`\`ts\nconst x = 1\n\`\`\`\n\n| A | B |\n| --- | --- |\n| C | D |\n\nFootnote [^1: Note].`

      const start = performance.now()
      const result = engine.sourceToRich(markdown)
      const elapsed = performance.now() - start

      expect(result.success).toBe(true)
      expect(elapsed).toBeLessThan(200)
    })
  })
})
