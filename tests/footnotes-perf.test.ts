/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { createEditorExtensions } from "@/lib/editor/extensions"
import { extractWritingAnnotationNodes, getMarkdownFootnotes } from "@/lib/editor/footnote-extension"
import { getMarkRange } from "@tiptap/core"

function createTestEditor(content = "") {
  return new Editor({
    extensions: createEditorExtensions(),
    content,
  })
}

function computeFootnotesForEditor(editor: Editor) {
  const json = editor.getJSON()
  const annotations = extractWritingAnnotationNodes(json)

  const highlights: Array<{
    type: "highlight"
    index: number
    text: string
    id: string
    anchor_text: string
    anchor_start: number
    anchor_end: number
  }> = []
  const highlightMark = editor.schema.marks.highlight
  if (highlightMark) {
    const annotationRanges: Array<{ from: number; to: number }> = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "annotationReference" || node.type.name === "footnoteReference") {
        annotationRanges.push({ from: pos, to: pos + node.nodeSize })
      }
    })

    const visitedRanges = new Set<string>()
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "text") return
      if (!node.marks.some((m) => m.type.name === "highlight")) return

      const $pos = editor.state.doc.resolve(pos)
      const range = getMarkRange($pos, highlightMark)
      if (!range) return

      const key = `${range.from}-${range.to}`
      if (visitedRanges.has(key)) return
      visitedRanges.add(key)

      const hasAnnotation = annotationRanges.some(
        (ar) =>
          (ar.from >= range.from && ar.to <= range.to) ||
          (ar.from >= range.from && ar.from <= range.to + 1),
      )

      if (!hasAnnotation) {
        const maxAnnotationHighlightIndex = annotations
          .filter((a) => a.type === "highlight")
          .reduce((max, a) => Math.max(max, a.index), 0)
        highlights.push({
          type: "highlight",
          index: maxAnnotationHighlightIndex + highlights.length + 1,
          text: "",
          id: `highlight:${highlights.length}`,
          anchor_text: editor.state.doc.textBetween(range.from, range.to),
          anchor_start: range.from,
          anchor_end: range.to,
        })
      }
    })
  }

  return [...annotations, ...highlights]
}

describe("footnotes useMemo performance", () => {
  it("computes footnotes for 5 highlights (2 annotated) within latency budget", () => {
    const editor = createTestEditor("First highlight one and second highlight two and third highlight three and fourth highlight four and fifth highlight five.")

    // Create 5 highlights: 2 annotated, 3 standalone
    // highlight 1: standalone "highlight one"
    editor.chain().setTextSelection({ from: 7, to: 21 }).setHighlight().run()
    // highlight 2: annotated "highlight two"
    editor.chain().setTextSelection({ from: 32, to: 46 }).setHighlight().addAnnotation("highlight", "annotated two").run()
    // highlight 3: standalone "highlight three"
    editor.chain().setTextSelection({ from: 52, to: 68 }).setHighlight().run()
    // highlight 4: annotated "highlight four"
    editor.chain().setTextSelection({ from: 79, to: 94 }).setHighlight().addAnnotation("highlight", "annotated four").run()
    // highlight 5: standalone "highlight five"
    editor.chain().setTextSelection({ from: 100, to: 115 }).setHighlight().run()

    // Verify content shape
    const firstRun = computeFootnotesForEditor(editor)
    const highlightCount = firstRun.filter((f) => f.type === "highlight").length
    const annotatedCount = firstRun.filter((f) => f.type === "highlight" && f.text !== "").length
    const standaloneCount = firstRun.filter((f) => f.type === "highlight" && f.text === "" && f.id?.startsWith("highlight:")).length

    expect(highlightCount).toBe(5)
    expect(annotatedCount).toBe(2)
    expect(standaloneCount).toBe(3)

    // Benchmark the useMemo computation
    const iterations = 1000
    const times: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now()
      computeFootnotesForEditor(editor)
      const t1 = performance.now()
      times.push(t1 - t0)
    }

    const min = Math.min(...times)
    const max = Math.max(...times)
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const p95 = times.sort((a, b) => a - b)[Math.floor(iterations * 0.95)]

    // eslint-disable-next-line no-console
    console.log(
      `[perf] footnotes useMemo benchmark (${iterations} iterations):`,
      { min: `${min.toFixed(3)} ms`, max: `${max.toFixed(3)} ms`, avg: `${avg.toFixed(3)} ms`, p95: `${p95.toFixed(3)} ms`, count: firstRun.length },
    )

    expect(avg).toBeLessThan(16)
    expect(p95).toBeLessThan(16)
    editor.destroy()
  })

  it("measures markdown mode footnotes parse within latency budget", () => {
    const markdown =
      "First ==highlight one== and second ==highlight two==[@h1: annotated two] and third ==highlight three== and fourth ==highlight four==[@h2: annotated four] and fifth ==highlight five==."

    const iterations = 1000
    const times: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now()
      getMarkdownFootnotes(markdown)
      const t1 = performance.now()
      times.push(t1 - t0)
    }

    const min = Math.min(...times)
    const max = Math.max(...times)
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const p95 = times.sort((a, b) => a - b)[Math.floor(iterations * 0.95)]

    // eslint-disable-next-line no-console
    console.log(
      `[perf] getMarkdownFootnotes benchmark (${iterations} iterations):`,
      { min: `${min.toFixed(3)} ms`, max: `${max.toFixed(3)} ms`, avg: `${avg.toFixed(3)} ms`, p95: `${p95.toFixed(3)} ms` },
    )

    expect(avg).toBeLessThan(16)
    expect(p95).toBeLessThan(16)
  })
})
