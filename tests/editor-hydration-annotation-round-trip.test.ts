/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { createEditorExtensions } from "@/lib/editor/extensions"
import { desktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import type { JSONContent } from "@tiptap/core"

function createTestEditor(content: string) {
  return new Editor({
    extensions: createEditorExtensions(),
    content,
  })
}

const collectHighlights = (node: JSONContent, result: Array<Record<string, unknown>> = []) => {
  for (const mark of node.marks ?? []) {
    if (mark.type === "highlight") result.push(mark.attrs as Record<string, unknown>)
  }
  for (const child of node.content ?? []) collectHighlights(child, result)
  return result
}

const collectRefs = (node: JSONContent, result: string[] = []) => {
  if (node.type === "annotationReference" || node.type === "footnoteReference") {
    result.push(String(node.attrs?.id))
  }
  for (const child of node.content ?? []) collectRefs(child, result)
  return result
}

describe("editor hydration keeps canonical annotations through the .md round trip", () => {
  it("survives richText -> richToSource -> sourceToRich -> setContent", () => {
    const editor = createTestEditor("<p>Hello world</p>")

    // UI path: select "world", highlight + footnote
    const doc = editor.state.doc
    const paragraph = doc.child(0)
    const from = 1 + "Hello ".length
    const to = from + "world".length
    editor
      .chain()
      .setTextSelection({ from, to })
      .setHighlight()
      .addFootnote("nota persistente")
      .run()

    const persisted = editor.getJSON()

    // Tab switch back — hydration sequence from editor-shell.tsx:2335-2348
    const hydrationEditor = createTestEditor("")
    hydrationEditor.commands.setContent(persisted)
    const serialized = desktopDocumentEngine.richToSource(hydrationEditor)
    expect(serialized.success).toBe(true)
    const parsed = desktopDocumentEngine.sourceToRich(serialized.success ? serialized.markdown : "")
    expect(parsed.success).toBe(true)
    hydrationEditor.commands.setContent(parsed.success ? parsed.snapshot.bodyJson : {})

    expect(serialized.success ? serialized.markdown : "").toMatch(/Annotation/)
    expect(collectRefs(persisted)).toHaveLength(1)
    expect(collectRefs(hydrationEditor.getJSON())).toHaveLength(1)
    expect(collectHighlights(hydrationEditor.getJSON())).toEqual(collectHighlights(persisted))
  })

  it("survives richText -> richToSource -> sourceToRich for ai annotation", () => {
    const editor = createTestEditor("<p>Second paragraph text</p>")
    const from = 1 + "Second ".length
    const to = from + "paragraph".length
    editor
      .chain()
      .setTextSelection({ from, to })
      .setHighlight()
      .addAnnotation("ai", "revisar esto")
      .run()

    const persisted = editor.getJSON()
    const hydrationEditor = createTestEditor("")
    hydrationEditor.commands.setContent(persisted)
    const serialized = desktopDocumentEngine.richToSource(hydrationEditor)
    const parsed = desktopDocumentEngine.sourceToRich(serialized.success ? serialized.markdown : "")
    hydrationEditor.commands.setContent(parsed.success ? parsed.snapshot.bodyJson : {})

    expect(collectRefs(persisted)).toHaveLength(1)
    expect(collectRefs(hydrationEditor.getJSON())).toHaveLength(1)
    expect(collectHighlights(hydrationEditor.getJSON())).toEqual(collectHighlights(persisted))
  })
})
