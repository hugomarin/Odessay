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
    it("serializes highlight annotation to [@hN: text]", () => {
      const editor = createTestEditor("Hello world")
      editor.chain().setTextSelection({ from: 1, to: 6 }).setHighlight().addAnnotation("highlight", "my note").run()

      const markdown = editor.storage.markdown.getMarkdown()
      expect(markdown).toContain("[@h1: my note]")
      editor.destroy()
    })

    it("serializes empty highlight annotation to [@hN: ]", () => {
      const editor = createTestEditor("Hello world")
      editor.chain().setTextSelection({ from: 1, to: 6 }).setHighlight().addAnnotation("highlight", "").run()

      const markdown = editor.storage.markdown.getMarkdown()
      expect(markdown).toContain("[@h1: ]")
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
      const attrs = AnnotationReferenceNode.config.addAttributes!()
      const parsed = {
        id: attrs.id.parseHTML!(element),
        type: attrs.type.parseHTML!(element),
        index: attrs.index.parseHTML!(element),
        text: attrs.text.parseHTML!(element),
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
