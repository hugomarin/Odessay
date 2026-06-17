/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { createEditorExtensions } from "@/lib/editor/extensions"
import {
  getMarkdownFootnotes,
  buildAiAnnotationCopy,
  extractStandaloneHighlights,
  extractWritingAnnotationNodes,
  normalizeMarkdownFootnotes,
} from "@/lib/editor/footnote-extension"
import { AnnotationReferenceNode } from "@/lib/editor/footnote-node"
import {
  marginRecordSchema,
  createMarginSchema,
  countTypedAnnotations,
} from "@/lib/margins/margins"

function createTestEditor(content = "") {
  return new Editor({
    extensions: createEditorExtensions(),
    content,
  })
}

describe("highlight annotation", () => {
  describe("markdown serialization", () => {
    it("serializes highlight annotation with a stable inline id", () => {
      const editor = createTestEditor("Hello world")
      editor.chain().setTextSelection({ from: 1, to: 6 }).setHighlight().addAnnotation("highlight", "my note").run()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markdown = (editor.storage as any).markdown?.getMarkdown() ?? ""
      expect(markdown).toMatch(/\[@h1\|[^\]:|]+: my note\]/)
      editor.destroy()
    })

    it("serializes empty highlight annotation with a stable inline id", () => {
      const editor = createTestEditor("Hello world")
      editor.chain().setTextSelection({ from: 1, to: 6 }).setHighlight().addAnnotation("highlight", "").run()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markdown = (editor.storage as any).markdown?.getMarkdown() ?? ""
      expect(markdown).toMatch(/\[@h1\|[^\]:|]+: \]/)
      editor.destroy()
    })
  })

  describe("markdown parsing", () => {
    it("parses [@h1: note] into a highlight annotation node", () => {
      const editor = createTestEditor("Text [@h1: note] more")
      const json = editor.getJSON()
      const annotationNodes = extractWritingAnnotationNodes(json)

      expect(annotationNodes).toHaveLength(1)
      expect(annotationNodes[0]).toMatchObject({
        type: "highlight",
        index: 1,
        text: "note",
      })
      editor.destroy()
    })

    it("parses mixed annotations including highlight", () => {
      const markdown = "Body[@1: AI note][@h1: Highlight note][@p1: Personal note][^1: Footnote]"
      const editor = createTestEditor(markdown)
      const annotations = extractWritingAnnotationNodes(editor.getJSON())

      expect(annotations.map((a) => ({ type: a.type, index: a.index, text: a.text }))).toEqual([
        { type: "ai", index: 1, text: "AI note" },
        { type: "highlight", index: 1, text: "Highlight note" },
        { type: "personal", index: 1, text: "Personal note" },
        { type: "footnote", index: 1, text: "Footnote" },
      ])
      editor.destroy()
    })
  })

  describe("footnote extension helpers", () => {
    it("getMarkdownFootnotes includes highlight annotations", () => {
      const markdown = "Body[@h1: Highlight note][@1: AI note][^1: Footnote]"
      expect(getMarkdownFootnotes(markdown)).toEqual([
        { type: "highlight", index: 1, text: "Highlight note" },
        { type: "ai", index: 1, text: "AI note" },
        { type: "footnote", index: 1, text: "Footnote" },
      ])
    })

    it("normalizeMarkdownFootnotes renumbers [@hN:] highlight annotations by occurrence order", () => {
      const markdown = "Body[@h3: third][@h1: first][@h2: second]"
      const normalized = normalizeMarkdownFootnotes(markdown)
      // Order-based renumbering: first occurrence becomes h1, second h2, third h3
      expect(normalized).toBe("Body[@h1: third][@h2: first][@h3: second]")
      const footnotes = getMarkdownFootnotes(normalized)
      expect(footnotes.map((f) => ({ type: f.type, index: f.index, text: f.text }))).toEqual([
        { type: "highlight", index: 1, text: "third" },
        { type: "highlight", index: 2, text: "first" },
        { type: "highlight", index: 3, text: "second" },
      ])
    })

    it("buildAiAnnotationCopy strips highlight annotations like personal ones", () => {
      const markdown = "==Passage==[@h1: remember this][@1: simplify]"
      const copy = buildAiAnnotationCopy(markdown)
      expect(copy.annotationsOnly).toContain("[@1: simplify]")
      expect(copy.annotationsOnly).not.toContain("[@h1: remember this]")
      expect(copy.fullText).toContain("==Passage==[@1: simplify]")
      expect(copy.fullText).not.toContain("[@h1: remember this]")
    })
  })

  describe("TipTap commands", () => {
    it("addAnnotation allows empty text for highlight type", () => {
      const editor = createTestEditor("Hello world")
      const result = editor.chain().setTextSelection({ from: 1, to: 6 }).setHighlight().addAnnotation("highlight", "").run()
      expect(result).toBe(true)

      const annotations = extractWritingAnnotationNodes(editor.getJSON())
      expect(annotations).toHaveLength(1)
      expect(annotations[0].type).toBe("highlight")
      expect(annotations[0].text).toBe("")
      editor.destroy()
    })

    it("addAnnotation still requires non-empty text for non-highlight types", () => {
      const editor = createTestEditor("Hello world")
      const result = editor.chain().setTextSelection({ from: 1, to: 6 }).setHighlight().addAnnotation("ai", "").run()
      expect(result).toBe(false)
      editor.destroy()
    })

    it("updateAnnotationType changes highlight to ai", () => {
      const editor = createTestEditor("Hello world")
      editor.chain().setTextSelection({ from: 1, to: 6 }).setHighlight().addAnnotation("highlight", "my note").run()

      const before = extractWritingAnnotationNodes(editor.getJSON())
      expect(before[0].type).toBe("highlight")

      editor.commands.updateAnnotationType("highlight", 1, "ai")

      const after = extractWritingAnnotationNodes(editor.getJSON())
      expect(after[0].type).toBe("ai")
      expect(after[0].text).toBe("my note")
      editor.destroy()
    })

    it("updateAnnotationType changes highlight to ai with new text", () => {
      const editor = createTestEditor("Hello world")
      editor.chain().setTextSelection({ from: 1, to: 6 }).setHighlight().addAnnotation("highlight", "old").run()

      editor.commands.updateAnnotationType("highlight", 1, "ai", "new text")

      const after = extractWritingAnnotationNodes(editor.getJSON())
      expect(after[0].type).toBe("ai")
      expect(after[0].text).toBe("new text")
      editor.destroy()
    })

    it("updateAnnotationType reindexes to avoid duplicate indices when converting to an existing type", () => {
      const editor = createTestEditor("First second")
      editor.chain().setTextSelection({ from: 1, to: 6 }).setHighlight().addAnnotation("ai", "AI note").run()
      editor.chain().setTextSelection({ from: 7, to: 13 }).setHighlight().addAnnotation("highlight", "highlight note").run()

      const before = extractWritingAnnotationNodes(editor.getJSON())
      expect(before).toHaveLength(2)
      expect(before[0]).toMatchObject({ type: "ai", index: 1 })
      expect(before[1]).toMatchObject({ type: "highlight", index: 1 })

      editor.commands.updateAnnotationType("highlight", 1, "ai")

      const after = extractWritingAnnotationNodes(editor.getJSON())
      expect(after).toHaveLength(2)
      const indices = after.map((a) => a.index)
      expect(new Set(indices).size).toBe(2)
      expect(indices).toContain(1)
      expect(indices).toContain(2)
      expect(after.every((a) => a.type === "ai")).toBe(true)
      editor.destroy()
    })

    it("extractWritingAnnotationNodes finds highlight annotations", () => {
      const editor = createTestEditor("Hello world")
      editor.chain().setTextSelection({ from: 2, to: 7 }).setHighlight().addAnnotation("highlight", "note").run()

      const annotations = extractWritingAnnotationNodes(editor.getJSON())
      expect(annotations).toHaveLength(1)
      expect(annotations[0]).toMatchObject({ type: "highlight", index: 1, text: "note" })
      editor.destroy()
    })
  })

  describe("margin schemas", () => {
    it("marginRecordSchema accepts highlight type", () => {
      const result = marginRecordSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        writing_id: "550e8400-e29b-41d4-a716-446655440001",
        reader_id: "550e8400-e29b-41d4-a716-446655440002",
        anchor_start: 0,
        anchor_end: 10,
        anchor_text: "hello",
        type: "highlight",
        text: "note",
        shared: false,
      })
      expect(result.success).toBe(true)
    })

    it("createMarginSchema accepts highlight type", () => {
      const result = createMarginSchema.safeParse({
        writing_id: "550e8400-e29b-41d4-a716-446655440001",
        anchor_start: 0,
        anchor_end: 10,
        anchor_text: "hello",
        type: "highlight",
        text: "note",
      })
      expect(result.success).toBe(true)
    })

    it("countTypedAnnotations counts highlights", () => {
      const margins = [
        { type: "personal" as const },
        { type: "highlight" as const },
        { type: "ai" as const },
        { type: "highlight" as const },
      ]
      expect(countTypedAnnotations(margins, "highlight")).toBe(2)
      expect(countTypedAnnotations(margins, "personal")).toBe(1)
    })
  })

  describe("AnnotationReferenceNode parsing", () => {
    it("parses data-annotation-type=highlight from HTML", () => {
      const html = `<sup data-annotation-id="test-id" data-annotation-type="highlight" data-annotation-index="1" data-annotation-text="note"></sup>`
      const doc = new DOMParser().parseFromString(html, "text/html")
      const element = doc.querySelector("sup")!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attrs = (AnnotationReferenceNode.config as any).addAttributes()
      const parsed = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: (attrs.id.parseHTML as any)(element),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: (attrs.type.parseHTML as any)(element),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        index: (attrs.index.parseHTML as any)(element),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        text: (attrs.text.parseHTML as any)(element),
      }
      expect(parsed).toEqual({
        id: "test-id",
        type: "highlight",
        index: 1,
        text: "note",
      })
    })
  })
})
