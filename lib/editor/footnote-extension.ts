import { Extension, getMarkRange } from "@tiptap/core"
import { TextSelection } from "@tiptap/pm/state"
import type { JSONContent } from "@tiptap/core"
import type { AnnotationType } from "@/lib/editor/footnote-node"

export type MarkdownAnnotation = {
  type: AnnotationType
  index: number
  text: string
}

export type MarkdownFootnote = MarkdownAnnotation

type AnnotationRef = {
  type: AnnotationType
  index: number
}

const INLINE_ANNOTATION_RE =
  /\[\^(\d+):\s*([^\]]*?)\]|\[@(p|c)?(\d+):\s*([^\]]*?)\]|\[\^(\d+)\]/g
const FOOTNOTE_DEFINITION_REGEX = /^\[\^(\d+)\]:\s*(.*)$/gm
const AI_ANNOTATION_WITH_CONTEXT_RE = /(?:==([^=]+)==)?\[@(p|c)?(\d+):\s*([^\]]*?)\]/g

const annotationTypeOrder: AnnotationType[] = ["footnote", "ai", "personal"]

const annotationSigil = (type: AnnotationType, index: number, text: string) => {
  const trimmedText = text.trim()

  switch (type) {
    case "ai":
      return `[@${index}: ${trimmedText}]`
    case "personal":
      return `[@p${index}: ${trimmedText}]`
    case "footnote":
    default:
      return `[^${index}: ${trimmedText}]`
  }
}

const stripLegacyFootnoteDefinitions = (markdown: string) =>
  markdown
    .split("\n")
    .filter((line) => !line.match(/^\[\^\d+\]:\s*/))
    .join("\n")
    .trimEnd()

const collectLegacyFootnoteDefinitions = (markdown: string) => {
  const definitions = new Map<number, string>()

  for (const match of markdown.matchAll(FOOTNOTE_DEFINITION_REGEX)) {
    const index = Number(match[1])
    if (!Number.isNaN(index)) {
      definitions.set(index, match[2].trim())
    }
  }

  return definitions
}

const collectInlineReferences = (markdown: string, definitions: Map<number, string>) => {
  const refs: AnnotationRef[] = []
  let match: RegExpExecArray | null

  INLINE_ANNOTATION_RE.lastIndex = 0
  while ((match = INLINE_ANNOTATION_RE.exec(markdown)) !== null) {
    if (match[1]) {
      refs.push({ type: "footnote", index: Number(match[1]) })
      continue
    }

    if (match[4]) {
      refs.push({
        type: match[3] === "p" ? "personal" : match[3] === "c" ? "personal" : "ai",
        index: Number(match[4]),
      })
      continue
    }

    if (match[6]) {
      const legacyIndex = Number(match[6])
      if (definitions.has(legacyIndex)) {
        refs.push({ type: "footnote", index: legacyIndex })
      }
    }
  }

  return refs
}

const uniqueReferenceOrderByType = (refs: AnnotationRef[]) => {
  const order = new Map<AnnotationType, number[]>()
  const seen = new Map<AnnotationType, Set<number>>()

  for (const type of annotationTypeOrder) {
    order.set(type, [])
    seen.set(type, new Set())
  }

  for (const ref of refs) {
    const typeSet = seen.get(ref.type)
    const typeOrder = order.get(ref.type)
    if (!typeSet || !typeOrder || typeSet.has(ref.index)) continue
    typeSet.add(ref.index)
    typeOrder.push(ref.index)
  }

  return order
}

export const normalizeMarkdownFootnotes = (markdown: string) => {
  const definitions = collectLegacyFootnoteDefinitions(markdown)
  const body = stripLegacyFootnoteDefinitions(markdown)
  const refs = collectInlineReferences(body, definitions)
  const orderByType = uniqueReferenceOrderByType(refs)
  const mapping = new Map<string, number>()

  for (const type of annotationTypeOrder) {
    const orderedRefs = orderByType.get(type) ?? []
    orderedRefs.forEach((index, next) => {
      mapping.set(`${type}:${index}`, next + 1)
    })
  }

  const normalized = body.replace(
    INLINE_ANNOTATION_RE,
    (_full, inlineFootnoteIndex, inlineFootnoteText, sigilPrefix, sigilIndex, sigilText, legacyIndex) => {
      if (inlineFootnoteIndex) {
        const nextIndex = mapping.get(`footnote:${Number(inlineFootnoteIndex)}`) ?? Number(inlineFootnoteIndex)
        return annotationSigil("footnote", nextIndex, String(inlineFootnoteText ?? ""))
      }

      if (sigilIndex) {
        const type = sigilPrefix === "p" ? "personal" : sigilPrefix === "c" ? "personal" : "ai"
        const nextIndex = mapping.get(`${type}:${Number(sigilIndex)}`) ?? Number(sigilIndex)
        return annotationSigil(type, nextIndex, String(sigilText ?? ""))
      }

      const nextIndex = mapping.get(`footnote:${Number(legacyIndex)}`) ?? Number(legacyIndex)
      return annotationSigil("footnote", nextIndex, definitions.get(Number(legacyIndex)) ?? "")
    },
  )

  return normalized.trimEnd()
}

export const getMarkdownFootnotes = (markdown: string): MarkdownAnnotation[] => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const annotations: MarkdownAnnotation[] = []
  let match: RegExpExecArray | null

  INLINE_ANNOTATION_RE.lastIndex = 0
  while ((match = INLINE_ANNOTATION_RE.exec(normalized)) !== null) {
    if (match[1]) {
      annotations.push({ type: "footnote", index: Number(match[1]), text: match[2].trim() })
      continue
    }

    if (match[4]) {
      annotations.push({
        type: match[3] === "p" ? "personal" : match[3] === "c" ? "personal" : "ai",
        index: Number(match[4]),
        text: match[5].trim(),
      })
    }
  }

  return annotations
}

export const appendMarkdownFootnote = (markdown: string, note: string) => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const annotations = getMarkdownFootnotes(normalized).filter((annotation) => annotation.type === "footnote")
  const nextIndex = annotations.length + 1
  return `${normalized}${annotationSigil("footnote", nextIndex, note.trim())}`.trimEnd()
}

export const updateMarkdownFootnote = (markdown: string, index: number, note: string) =>
  normalizeMarkdownFootnotes(markdown).replaceAll(
    new RegExp(`\\[\\^${index}:\\s*[^\\]]*\\]`, "g"),
    annotationSigil("footnote", index, note.trim()),
  )

export const removeMarkdownFootnote = (markdown: string, index: number) =>
  normalizeMarkdownFootnotes(
    normalizeMarkdownFootnotes(markdown).replaceAll(
      new RegExp(`\\[\\^${index}:\\s*[^\\]]*\\]`, "g"),
      "",
    ),
  ).trimEnd()

export const extractAiAnnotationsFromMarkdown = (markdown: string): string => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const results: string[] = []

  AI_ANNOTATION_WITH_CONTEXT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = AI_ANNOTATION_WITH_CONTEXT_RE.exec(normalized)) !== null) {
    const typePrefix = match[2]
    if (typePrefix) continue // skip personal (@p) and legacy collaborative (@c)

    const anchorText = match[1]
    const index = Number(match[3])
    const text = match[4].trim()
    const sigil = annotationSigil("ai", index, text)
    results.push(anchorText ? `"${anchorText}" ${sigil}` : sigil)
  }

  return results.join("\n")
}

export const buildAiAnnotationCopy = (
  markdown: string,
): { annotationsOnly: string; fullText: string } => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  return {
    annotationsOnly: extractAiAnnotationsFromMarkdown(normalized),
    fullText: normalized.replaceAll(/\[@(?:p|c)\d+:\s*[^\]]*?\]/g, "").trimEnd(),
  }
}

export type WritingAnnotationNode = {
  id: string
  type: AnnotationType
  index: number
  text: string
  anchor_text: string
  anchor_start: number
  anchor_end: number
}

type TextCursor = {
  offset: number
}

const collectAnnotationNodes = (
  node: JSONContent,
  cursor: TextCursor,
  result: WritingAnnotationNode[],
  activeHighlightAnchor: string | null,
) => {
  if (node.type === "text") {
    cursor.offset += node.text?.length ?? 0
    return
  }

  if (node.type === "hardBreak") {
    cursor.offset += 1
    return
  }

  if (node.type === "annotationReference" || node.type === "footnoteReference") {
    const anchorText = activeHighlightAnchor ?? ""
    result.push({
      id: String(node.attrs?.id ?? crypto.randomUUID()),
      type: (node.attrs?.type as AnnotationType) ?? "footnote",
      index: Number(node.attrs?.index ?? 0),
      text: String(node.attrs?.text ?? ""),
      anchor_text: anchorText,
      anchor_start: anchorText ? cursor.offset - anchorText.length : cursor.offset,
      anchor_end: cursor.offset,
    })
    return
  }

  const nextHighlightAnchor =
    node.content && node.content.length
      ? activeHighlightAnchor
      : null

  if (node.content?.length) {
    let pendingAnchor: string | null = null
    for (const child of node.content) {
      if (child.type === "text" && child.marks?.some((mark) => mark.type === "highlight")) {
        pendingAnchor = (pendingAnchor ?? "") + (child.text ?? "")
        collectAnnotationNodes(child, cursor, result, pendingAnchor)
        continue
      }

      const isAnnotation = child.type === "annotationReference" || child.type === "footnoteReference"
      collectAnnotationNodes(child, cursor, result, isAnnotation ? pendingAnchor : nextHighlightAnchor)
      pendingAnchor = null
    }
  }

  if (node.type === "paragraph" || node.type === "heading" || node.type === "blockquote") {
    cursor.offset += 1
  }
}

export const extractWritingAnnotationNodes = (bodyJson: JSONContent | null | undefined) => {
  if (!bodyJson || typeof bodyJson !== "object") {
    return [] as WritingAnnotationNode[]
  }

  const result: WritingAnnotationNode[] = []
  collectAnnotationNodes(bodyJson, { offset: 0 }, result, null)
  return result
}

export type StandaloneHighlight = {
  type: "highlight"
  anchor_text: string
}

const collectStandaloneHighlights = (node: JSONContent, result: StandaloneHighlight[]) => {
  if (node.content?.length) {
    let pending: string | null = null
    for (const child of node.content) {
      if (child.type === "text" && child.marks?.some((m) => m.type === "highlight")) {
        pending = (pending ?? "") + (child.text ?? "")
        continue
      }
      if (pending) {
        const isAnnotation = child.type === "annotationReference" || child.type === "footnoteReference"
        if (!isAnnotation) result.push({ type: "highlight", anchor_text: pending })
        pending = null
      }
      collectStandaloneHighlights(child, result)
    }
    if (pending) result.push({ type: "highlight", anchor_text: pending })
  }
}

export const extractStandaloneHighlights = (bodyJson: JSONContent | null | undefined): StandaloneHighlight[] => {
  if (!bodyJson || typeof bodyJson !== "object") return []
  const result: StandaloneHighlight[] = []
  collectStandaloneHighlights(bodyJson, result)
  return result
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      addFootnote: (text: string) => ReturnType
      addAnnotation: (type: AnnotationType, text: string) => ReturnType
      updateFootnote: (index: number, text: string) => ReturnType
      updateAnnotation: (type: AnnotationType, index: number, text: string) => ReturnType
      deleteFootnote: (index: number) => ReturnType
      deleteAnnotation: (type: AnnotationType, index: number) => ReturnType
    }
  }
}

export const FootnoteExtension = Extension.create({
  name: "footnote",

  addCommands() {
    return {
      addFootnote:
        (text: string) =>
        ({ editor, tr, dispatch }) => {
          const trimmedText = text.trim()

          if (!trimmedText) {
            return false
          }

          let maxIndex = 0
          editor.state.doc.descendants((node) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (node.attrs.type as AnnotationType | undefined) === "footnote"
            ) {
              const idx = node.attrs.index as number
              if (idx > maxIndex) maxIndex = idx
            }
          })
          const nextIndex = maxIndex + 1

          const insertPos = editor.state.selection.to
          const nodeType =
            editor.schema.nodes.annotationReference ?? editor.schema.nodes.footnoteReference
          if (!nodeType) return false

          const refNode = nodeType.create({
            id: crypto.randomUUID(),
            type: "footnote",
            index: nextIndex,
            text: trimmedText,
          })
          tr.setSelection(TextSelection.create(tr.doc, insertPos))
          tr.insert(insertPos, refNode)

          if (dispatch) dispatch(tr)
          return true
        },

      addAnnotation:
        (type: AnnotationType, text: string) =>
        ({ editor, tr, dispatch }) => {
          const trimmedText = text.trim()
          if (!trimmedText) return false

          let maxIndex = 0
          editor.state.doc.descendants((node) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (node.attrs.type as AnnotationType | undefined) === type
            ) {
              const idx = node.attrs.index as number
              if (idx > maxIndex) maxIndex = idx
            }
          })

          const insertPos = editor.state.selection.to
          const nodeType =
            editor.schema.nodes.annotationReference ?? editor.schema.nodes.footnoteReference
          if (!nodeType) return false

          const refNode = nodeType.create({
            id: crypto.randomUUID(),
            type,
            index: maxIndex + 1,
            text: trimmedText,
          })
          tr.setSelection(TextSelection.create(tr.doc, insertPos))
          tr.insert(insertPos, refNode)

          if (dispatch) dispatch(tr)
          return true
        },

      updateFootnote:
        (index: number, text: string) =>
        ({ editor, tr, dispatch }) => {
          const positions: number[] = []

          editor.state.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (node.attrs.type as AnnotationType | undefined) === "footnote" &&
              (node.attrs.index as number) === index
            ) {
              positions.push(pos)
            }
          })

          if (!positions.length) return false

          for (const pos of positions) {
            const node = editor.state.doc.nodeAt(pos)
            if (!node) continue
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, text: text.trim() })
          }

          if (dispatch) dispatch(tr)
          return true
        },

      deleteFootnote:
        (index: number) =>
        ({ editor, tr, dispatch }) => {
          const positions: { pos: number; size: number }[] = []

          editor.state.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (node.attrs.type as AnnotationType | undefined) === "footnote" &&
              (node.attrs.index as number) === index
            ) {
              positions.push({ pos, size: node.nodeSize })
            }
          })

          if (!positions.length) return false

          const highlightMarkType = editor.schema.marks.highlight
          for (const { pos, size } of [...positions].reverse()) {
            if (highlightMarkType) {
              const $beforeRef = tr.doc.resolve(pos)
              const range = getMarkRange($beforeRef, highlightMarkType)
              if (range) {
                tr.removeMark(range.from, range.to, highlightMarkType)
              }
            }
            tr.delete(pos, pos + size)
          }

          const nodePositions: { pos: number; currentIndex: number }[] = []
          tr.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (node.attrs.type as AnnotationType | undefined) === "footnote"
            ) {
              nodePositions.push({ pos, currentIndex: node.attrs.index as number })
            }
          })

          nodePositions.sort((a, b) => a.pos - b.pos)
          const seenOriginal = new Map<number, number>()
          let nextIdx = 1
          for (const { currentIndex } of nodePositions) {
            if (!seenOriginal.has(currentIndex)) {
              seenOriginal.set(currentIndex, nextIdx++)
            }
          }

          for (const { pos, currentIndex } of [...nodePositions].reverse()) {
            const newIndex = seenOriginal.get(currentIndex) ?? currentIndex
            if (newIndex !== currentIndex) {
              const node = tr.doc.nodeAt(pos)
              if (node) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, index: newIndex })
              }
            }
          }

          if (dispatch) dispatch(tr)
          return true
        },

      updateAnnotation:
        (type: AnnotationType, index: number, text: string) =>
        ({ editor, tr, dispatch }) => {
          const positions: number[] = []
          editor.state.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (node.attrs.type as AnnotationType | undefined) === type &&
              (node.attrs.index as number) === index
            ) {
              positions.push(pos)
            }
          })
          if (!positions.length) return false
          for (const pos of positions) {
            const node = editor.state.doc.nodeAt(pos)
            if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, text: text.trim() })
          }
          if (dispatch) dispatch(tr)
          return true
        },

      deleteAnnotation:
        (type: AnnotationType, index: number) =>
        ({ editor, tr, dispatch }) => {
          const positions: { pos: number; size: number }[] = []
          editor.state.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (node.attrs.type as AnnotationType | undefined) === type &&
              (node.attrs.index as number) === index
            ) {
              positions.push({ pos, size: node.nodeSize })
            }
          })
          if (!positions.length) return false
          const highlightMarkType = editor.schema.marks.highlight
          for (const { pos, size } of [...positions].reverse()) {
            if (highlightMarkType) {
              const $beforeRef = tr.doc.resolve(pos)
              const range = getMarkRange($beforeRef, highlightMarkType)
              if (range) tr.removeMark(range.from, range.to, highlightMarkType)
            }
            tr.delete(pos, pos + size)
          }
          // Reindex remaining annotations of the same type
          const remaining: { pos: number; currentIndex: number }[] = []
          tr.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (node.attrs.type as AnnotationType | undefined) === type
            ) {
              remaining.push({ pos, currentIndex: node.attrs.index as number })
            }
          })
          remaining.sort((a, b) => a.pos - b.pos)
          const seen = new Map<number, number>()
          let nextIdx = 1
          for (const { currentIndex } of remaining) {
            if (!seen.has(currentIndex)) seen.set(currentIndex, nextIdx++)
          }
          for (const { pos, currentIndex } of [...remaining].reverse()) {
            const newIndex = seen.get(currentIndex) ?? currentIndex
            if (newIndex !== currentIndex) {
              const node = tr.doc.nodeAt(pos)
              if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, index: newIndex })
            }
          }
          if (dispatch) dispatch(tr)
          return true
        },
    }
  },
})
