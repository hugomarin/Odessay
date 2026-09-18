/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, beforeEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Editor, getMarkRange } from "@tiptap/core"
import { canonicalizeControlledMarkdown } from "@/lib/document-components"
import { parseMarkdownToSnapshot, serializeDocumentToMarkdown } from "@/lib/editor/document-serialization"
import { materializeControlledSemanticMarks } from "@/lib/editor/markdown-format"
import { applyEntityMark, applySemanticHighlight } from "@/lib/editor/semantic-marks"
import { sanitizeWritingBodyJson } from "@/lib/editor/content-sanitizer"
import { renderWritingBodyHtml } from "@/lib/reading/render-body-html"
import { createEditorExtensions } from "@/lib/editor/extensions"

const fixtures = join(process.cwd(), "tests/fixtures/document-components")
const fixture = (path: string) => readFileSync(join(fixtures, path), "utf8")

const createTestEditor = (content: string = "") =>
  new Editor({
    extensions: createEditorExtensions(),
    content,
  })

type MarkEntry = { type?: string; attrs?: Record<string, unknown> }

const collectMarks = (
  node: unknown,
  predicate: (mark: MarkEntry) => boolean,
  result: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> => {
  if (!node || typeof node !== "object") return result
  const current = node as { marks?: MarkEntry[]; content?: unknown[] }
  for (const mark of current.marks ?? []) {
    if (mark.type && predicate(mark)) {
      result.push(mark.attrs ?? {})
    }
  }
  for (const child of current.content ?? []) {
    collectMarks(child, predicate, result)
  }
  return result
}

const collectEntityRanges = (editor: Editor) => {
  const entityMarkType = editor.schema.marks.entity
  const ranges: Array<{ from: number; to: number }> = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find((candidate) => candidate.type.name === "entity")
    if (!mark) return
    const range = getMarkRange(editor.state.doc.resolve(pos), entityMarkType, mark.attrs)
    if (!range) return
    if (!ranges.some((existing) => existing.from === range.from && existing.to === range.to)) {
      ranges.push(range)
    }
  })
  return ranges
}

describe("ODE-532 entity and highlight semantic marks", () => {
  beforeEach(() => {
    let uuidSeed = 0
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `ent-${String(++uuidSeed).padStart(4, "0")}`),
    })
  })

  describe("canonical round-trip", () => {
    it("round-trips an Entity mention through Rich parse and serialization", () => {
      const source = 'Worked at <Entity id="ent-123" type="company" ref="https://example.com">Aplyca</Entity>.'
      const parsed = parseMarkdownToSnapshot(source)
      const markdown = serializeDocumentToMarkdown(parsed.bodyJson)

      expect(markdown).toBe(source)
      const entityMarks = collectMarks(parsed.bodyJson, (mark) => mark.type === "entity")
      expect(entityMarks).toEqual([
        { entityId: "ent-123", entityType: "company", entityRef: "https://example.com" },
      ])
    })

    it("round-trips a Highlight with and without color", () => {
      const source = '<Highlight color="green">chosen</Highlight> and <Highlight>plain</Highlight>'
      const canonical = canonicalizeControlledMarkdown(source)
      expect(canonical).toBe(source)

      const parsed = parseMarkdownToSnapshot(source)
      const markdown = serializeDocumentToMarkdown(parsed.bodyJson)
      expect(markdown).toBe(source)

      const colors = collectMarks(parsed.bodyJson, (mark) => mark.type === "semanticHighlight").map(
        (attrs) => attrs.highlightColor,
      )
      expect(colors).toEqual(["green", null])
    })

    it("keeps shared entity identity across multiple mentions", () => {
      const source =
        '<Entity id="ent-1" type="company">Aplyca</Entity> and <Entity id="ent-1" type="company">Aplyca</Entity>'
      const parsed = parseMarkdownToSnapshot(source)
      const markdown = serializeDocumentToMarkdown(parsed.bodyJson)

      expect(markdown).toBe(source)
      const ids = collectMarks(parsed.bodyJson, (mark) => mark.type === "entity").map(
        (attrs) => attrs.entityId,
      )
      expect(ids).toEqual(["ent-1", "ent-1"])
    })

    it("round-trips nesting and native marks inside Entity and Highlight", () => {
      const source =
        'Text <Entity id="ent-2" type="person"><Highlight color="amber">**bold** and [link](https://example.com)</Highlight></Entity> end'
      const canonical = canonicalizeControlledMarkdown(source)
      const parsed = parseMarkdownToSnapshot(source)
      const markdown = serializeDocumentToMarkdown(parsed.bodyJson)
      const reparsed = parseMarkdownToSnapshot(markdown)

      expect(canonical).toBe(source)
      expect(markdown).toBe(source)
      const entityIds = new Set(
        collectMarks(reparsed.bodyJson, (mark) => mark.type === "entity").map((attrs) => attrs.entityId),
      )
      expect(entityIds).toEqual(new Set(["ent-2"]))
      expect(
        collectMarks(reparsed.bodyJson, (mark) => mark.type === "semanticHighlight").map(
          (attrs) => attrs.highlightColor,
        ),
      ).toEqual(["amber", "amber", "amber"])
    })

    it("keeps entity and highlight marks byte-stable across reopen", () => {
      const source =
        'First <Entity id="ent-1" type="company">mention</Entity>, then <Highlight color="indigo">passage</Highlight>, then <Entity id="ent-1" type="company">second mention</Entity>'
      const parsed = parseMarkdownToSnapshot(source)
      const markdown = serializeDocumentToMarkdown(parsed.bodyJson)
      const reparsed = parseMarkdownToSnapshot(markdown)
      const serializedAgain = serializeDocumentToMarkdown(reparsed.bodyJson)

      expect(serializedAgain).toBe(source)
    })

    it("preserves an unsupported Highlight color without rewriting it", () => {
      const source = '<Highlight color="fuchsia">rare</Highlight>'
      const canonical = canonicalizeControlledMarkdown(source)
      expect(canonical).toBe(source)
      const parsed = parseMarkdownToSnapshot(source)
      expect(serializeDocumentToMarkdown(parsed.bodyJson)).toBe(source)
    })

    it("preserves invalid Entity source as opaque and never rewrites it", () => {
      const source = '<Entity type="person">missing id</Entity>'
      expect(canonicalizeControlledMarkdown(source)).toBe(source)
    })
  })

  describe("selection owner", () => {
    it("applies an entity mark with a minted identity", () => {
      const editor = createTestEditor("<p>Select this company</p>")
      editor.commands.setTextSelection({ from: 1, to: 7 })

      const decision = applyEntityMark(editor, { from: 1, to: 7, type: "company" })
      expect(decision.ok).toBe(true)

      const marks = collectMarks(editor.getJSON(), (mark) => mark.type === "entity")
      expect(marks).toHaveLength(1)
      expect(marks[0].entityType).toBe("company")
      expect(marks[0].entityRef).toBeNull()
    })

    it("rejects an empty selection without mutation", () => {
      const editor = createTestEditor("<p>text</p>")

      const entity = applyEntityMark(editor, { from: 2, to: 2, type: "person" })
      const highlight = applySemanticHighlight(editor, { from: 2, to: 2, color: "amber" })

      expect(entity.ok).toBe(false)
      expect(highlight.ok).toBe(false)
      expect(editor.getJSON()).toEqual(createTestEditor("<p>text</p>").getJSON())
    })

    it("rejects a selection crossing blocks without mutation", () => {
      const editor = createTestEditor("<p>first</p><p>second</p>")

      const decision = applyEntityMark(editor, { from: 1, to: 14, type: "person" })

      expect(decision.ok).toBe(false)
      expect(collectMarks(editor.getJSON(), (mark) => mark.type === "entity")).toHaveLength(0)
    })

    it("rejects a range that crosses an existing semantic mark without mutation", () => {
      const editor = createTestEditor("<p>plain bold semantic tail</p>")
      editor.commands.setTextSelection({ from: 12, to: 20 })
      expect(applyEntityMark(editor, { from: 12, to: 20, type: "person" }).ok).toBe(true)

      const crossing = applySemanticHighlight(editor, { from: 7, to: 16, color: "green" })
      expect(crossing.ok).toBe(false)
      expect(collectMarks(editor.getJSON(), (mark) => mark.type === "semanticHighlight")).toHaveLength(0)
    })

    it("reapplying the same kind on the same range edits attributes instead of duplicating", () => {
      const editor = createTestEditor("<p>chosen text</p>")
      editor.commands.setTextSelection({ from: 1, to: 7 })
      applySemanticHighlight(editor, { from: 1, to: 7, color: "amber" })

      const recolor = applySemanticHighlight(editor, { from: 1, to: 7, color: "green" })
      expect(recolor.ok).toBe(true)
      const marks = collectMarks(editor.getJSON(), (mark) => mark.type === "semanticHighlight")
      expect(marks).toEqual([{ highlightColor: "green" }])
    })

    it("rejects a conflicting entity id and accepts a compatible duplicate", () => {
      const editor = createTestEditor("<p>one two</p>")
      editor.commands.setTextSelection({ from: 1, to: 4 })
      applyEntityMark(editor, { from: 1, to: 4, id: "ent-9", type: "company" })

      const conflicting = applyEntityMark(editor, { from: 5, to: 8, id: "ent-9", type: "person" })
      expect(conflicting.ok).toBe(false)

      const compatible = applyEntityMark(editor, { from: 5, to: 8, id: "ent-9", type: "company" })
      expect(compatible.ok).toBe(true)
      const marks = collectMarks(editor.getJSON(), (mark) => mark.type === "entity")
      expect(marks).toHaveLength(2)
      expect(marks.every((attrs) => attrs.entityType === "company")).toBe(true)
    })

    it("enforces the canonical nesting order between Entity and Highlight", () => {
      const editor = createTestEditor("<p>head tail</p>")
      editor.commands.setTextSelection({ from: 1, to: 10 })
      expect(applySemanticHighlight(editor, { from: 1, to: 10, color: "amber" }).ok).toBe(true)

      const wrapping = applyEntityMark(editor, { from: 1, to: 10, type: "company" })
      expect(wrapping.ok).toBe(true)
      expect(collectMarks(editor.getJSON(), (mark) => mark.type === "entity")).toHaveLength(1)

      const entity = createTestEditor('<p><Entity id="ent-3" type="company">Aplyca Inc</Entity></p>')
      const illegal = applySemanticHighlight(entity, { from: 1, to: 12, color: "green" })
      expect(illegal.ok).toBe(false)
    })

    it("restores text and mark in one undo step", () => {
      const editor = createTestEditor("<p>undo me</p>")
      editor.commands.setTextSelection({ from: 1, to: 8 })
      applySemanticHighlight(editor, { from: 1, to: 8, color: "slate" })
      const markedJson = editor.getJSON()

      editor.commands.undo()
      expect(collectMarks(editor.getJSON(), (mark) => mark.type === "semanticHighlight")).toHaveLength(0)

      editor.commands.redo()
      expect(collectMarks(editor.getJSON(), (mark) => mark.type === "semanticHighlight")).toEqual([
        { highlightColor: "slate" },
      ])
      expect(editor.getJSON()).toEqual(markedJson)
    })

    it("does not extend a mark when typing at its boundary", () => {
      const editor = createTestEditor("<p>Aplyca</p>")
      editor.commands.setTextSelection({ from: 1, to: 7 })
      const applied = applyEntityMark(editor, { from: 1, to: 7, id: "ent-4", type: "company" })
      expect(applied.ok).toBe(true)

      // Type right after the closing boundary.
      editor.commands.setTextSelection(7)
      editor.commands.insertContent("s")

      const [mark] = collectEntityRanges(editor)
      expect(editor.state.doc.textBetween(mark.to, mark.to + 2)).toBe("s")
      expect(editor.state.doc.textBetween(mark.from, mark.to)).toBe("Aplyca")
    })
  })

  describe("projections", () => {
    it("keeps reading text-only for entity and highlight without identity", () => {
      const source =
        '<Entity id="ent-1" type="company" ref="https://internal">Aplyca</Entity> and <Highlight color="green">passage</Highlight>'
      const parsed = parseMarkdownToSnapshot(source)
      const reading = sanitizeWritingBodyJson(parsed.bodyJson)

      const entities = collectMarks(reading, (mark) => mark.type === "entity")
      expect(entities).toEqual([{ entityType: "company" }])

      const highlights = collectMarks(reading, (mark) => mark.type === "semanticHighlight")
      expect(highlights).toEqual([{ highlightColor: "green" }])

      const { bodyHtml } = renderWritingBodyHtml(reading, "")
      expect(bodyHtml).toContain("Aplyca")
      expect(bodyHtml).toContain("passage")
      expect(bodyHtml).not.toContain("ent-1")
      expect(bodyHtml).not.toContain("https://internal")
    })

    it("keeps AI/body text projection to visible text only", () => {
      const source = 'Before <Entity id="ent-1" type="company">Aplyca</Entity> and <Highlight>key</Highlight>'
      const parsed = parseMarkdownToSnapshot(source)
      expect(parsed.bodyText).toBe("Before Aplyca and key")
    })
  })

  describe("scale", () => {
    it.each([10, 100, 1000])("round-trips the %i-mark fixture", (count) => {
      const source = fixture(`scale/marks-${count}.md`)
      expect(canonicalizeControlledMarkdown(source)).toBe(source)
    })

    it("round-trips 100 marks through the rich editor pipeline", () => {
      const source = fixture("scale/marks-100.md")
      const parsed = parseMarkdownToSnapshot(source)
      const markdown = serializeDocumentToMarkdown(parsed.bodyJson)
      const reparsed = parseMarkdownToSnapshot(markdown)
      const again = serializeDocumentToMarkdown(reparsed.bodyJson)

      // The editor drops trailing blank lines; content between marks is
      // byte-stable from the first canonical serialization onward.
      expect(markdown).toBe(source.replace(/\n+$/, ""))
      expect(again).toBe(markdown)
    })

    it("materializes every canonical tag exactly once at scale", () => {
      const source = fixture("scale/marks-100.md")
      const materialized = materializeControlledSemanticMarks(source)
      expect(materialized.match(/data-entity-id=/g)).toHaveLength(50)
      expect(materialized.match(/data-highlight-color=/g)).toHaveLength(50)
    })
  })
})
