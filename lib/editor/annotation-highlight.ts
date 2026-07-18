import { getMarkRange } from "@tiptap/core"
import Highlight from "@tiptap/extension-highlight"
import type { Editor } from "@tiptap/react"
import { ANNOTATION_TYPES, type AnnotationType } from "@/lib/editor/footnote-node"

export type StandaloneHighlightTarget = {
  anchorText: string
  anchorStart?: number
  anchorEnd?: number
}

export type StandaloneHighlightResolution =
  | { status: "found"; range: { from: number; to: number } }
  | { status: "missing" | "ambiguous" }

export const resolveStandaloneHighlightRange = (
  editor: Editor,
  target: StandaloneHighlightTarget,
): StandaloneHighlightResolution => {
  const highlightMarkType = editor.schema.marks.highlight
  if (!highlightMarkType || !target.anchorText) {
    return { status: "missing" }
  }

  const candidates: Array<{ from: number; to: number; text: string }> = []
  const visitedRanges = new Set<string>()

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const highlightMark = node.marks.find(
      (mark) => mark.type === highlightMarkType && mark.attrs.annotationType == null,
    )
    if (!highlightMark) return

    const range = getMarkRange(editor.state.doc.resolve(pos), highlightMarkType, highlightMark.attrs)
    if (!range) return

    const key = `${range.from}:${range.to}`
    if (visitedRanges.has(key)) return
    visitedRanges.add(key)
    candidates.push({
      ...range,
      text: editor.state.doc.textBetween(range.from, range.to),
    })
  })

  if (target.anchorStart !== undefined && target.anchorEnd !== undefined) {
    const positionalMatch = candidates.find(
      (candidate) =>
        candidate.from === target.anchorStart &&
        candidate.to === target.anchorEnd &&
        candidate.text === target.anchorText,
    )
    if (positionalMatch) {
      return {
        status: "found",
        range: { from: positionalMatch.from, to: positionalMatch.to },
      }
    }
  }

  const textMatches = candidates.filter((candidate) => candidate.text === target.anchorText)
  if (textMatches.length === 1) {
    return {
      status: "found",
      range: { from: textMatches[0].from, to: textMatches[0].to },
    }
  }

  return { status: textMatches.length > 1 ? "ambiguous" : "missing" }
}

export const deleteStandaloneHighlight = (
  editor: Editor,
  target: StandaloneHighlightTarget,
): StandaloneHighlightResolution => {
  const resolution = resolveStandaloneHighlightRange(editor, target)
  if (resolution.status !== "found") {
    return resolution
  }

  const didDelete = editor
    .chain()
    .setTextSelection(resolution.range)
    .unsetHighlight()
    .run()

  return didDelete ? resolution : { status: "missing" }
}

export const coerceHighlightAnnotationType = (value: unknown): AnnotationType | null => {
  if (value === "collaborative") return "personal"
  return typeof value === "string" && ANNOTATION_TYPES.includes(value as AnnotationType)
    ? (value as AnnotationType)
    : value == null
      ? null
      : "highlight"
}

export const AnnotationHighlight = Highlight.extend({
  addAttributes() {
    return {
      annotationType: {
        default: null,
        parseHTML: (element) =>
          coerceHighlightAnnotationType(element.getAttribute("data-annotation-type")),
        renderHTML: (attrs) => {
          const annotationType = coerceHighlightAnnotationType(attrs.annotationType)
          return annotationType ? { "data-annotation-type": annotationType } : {}
        },
      },
    }
  },
})
