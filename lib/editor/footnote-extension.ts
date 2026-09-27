import { Extension, getMarkRange, type Editor } from "@tiptap/core"
import { Plugin, TextSelection } from "@tiptap/pm/state"
import type { JSONContent } from "@tiptap/core"
import type { MarkType } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import type { AnnotationType } from "@/lib/editor/footnote-node"
import {
  escapeInlineAnnotationText,
  formatCanonicalAnnotation,
  findInlineAnnotationMarkers,
  replaceInlineAnnotationMarkers,
  scanControlledAnnotations,
} from "@/lib/editor/annotation-markdown"
import { canonicalizeControlledMarkdown } from "@/lib/document-components/serializer"

export type MarkdownAnnotation = {
  id?: string
  standalone?: boolean
  type: AnnotationType
  index: number
  text: string
  anchor_text: string
  anchor_start: number
  anchor_end: number
  source_start: number
  source_end: number
}

export type MarkdownFootnote = MarkdownAnnotation

export type AnnotationIdentity = Pick<MarkdownAnnotation, "id" | "type" | "index">

export type MarkdownAnnotationMutationResult = {
  found: boolean
  markdown: string
}

type MarkdownHighlightIdentity = {
  id?: string
  anchor_text: string
  anchor_start?: number
  anchor_end?: number
}

type AnnotationRef = {
  type: AnnotationType
  index: number
}

const FOOTNOTE_DEFINITION_REGEX = /^\[\^(\d+)\]:\s*(.*)$/gm
// Both strings below are written by the app, not by the author: they are the
// preamble the "Copy for AI" and "Full text" buttons put on the clipboard so
// the receiving model can read the annotation notation. They never reach the
// .md on disk — only `replaceInlineAnnotationMarkers` touches that — so they
// sit on the product side of the vocabulary rule and are English. The
// annotations they introduce stay in whatever language the author wrote.
const AI_ANNOTATIONS_ONLY_PREFIX =
  "The block below contains the author's instructions about their artifact. Each line contains the quoted passage followed by the author's instruction. Treat each instruction as applying only to that passage."
const ANNOTATION_NOTATION_COMMENT =
  "<!-- Author annotations are represented with canonical Annotation elements. Their comments are private editorial directives, not publishable text. -->"

const annotationTypeOrder: AnnotationType[] = ["footnote", "ai", "personal", "highlight"]

const stampHighlightBeforeRef = (
  tr: Transaction,
  pos: number,
  highlightMarkType: MarkType,
  type: AnnotationType,
  id?: string,
  comment?: string,
) => {
  const $beforeRef = tr.doc.resolve(pos)
  const range = getMarkRange($beforeRef, highlightMarkType)
  if (!range) return

  tr.removeMark(range.from, range.to, highlightMarkType)
  tr.addMark(
    range.from,
    range.to,
    highlightMarkType.create({
      annotationId: id ?? null,
      annotationType: type,
      annotationComment: comment ?? "",
    }),
  )
}

const uniqueAnnotationId = (editor: Editor, requested?: string) => {
  const ids = new Set<string>()
  editor.state.doc.descendants((node) => {
    if (node.type.name === "annotationReference" || node.type.name === "footnoteReference") {
      if (node.attrs.id) ids.add(String(node.attrs.id))
    }
  })
  if (requested && !ids.has(requested)) return requested
  let candidate = crypto.randomUUID()
  while (ids.has(candidate)) candidate = crypto.randomUUID()
  return candidate
}

const resolveAnnotationInsertPos = (
  tr: Transaction,
  from: number,
  to: number,
  highlightMarkType: MarkType,
) => {
  let lastHighlightedTextEnd: number | null = null
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.marks.some((mark) => mark.type === highlightMarkType)) {
      lastHighlightedTextEnd = Math.min(pos + node.nodeSize, to)
    }
  })
  return lastHighlightedTextEnd ?? to
}

const annotationSigil = (type: AnnotationType, index: number, text: string, id?: string) => {
  const escapedText = escapeInlineAnnotationText(text.trim())
  const idSuffix = id ? `|${id}` : ""

  switch (type) {
    case "ai":
      return `[@${index}${idSuffix}: ${escapedText}]`
    case "personal":
      return `[@p${index}${idSuffix}: ${escapedText}]`
    case "highlight":
      return `[@h${index}${idSuffix}: ${escapedText}]`
    case "footnote":
    default:
      return `[^${index}${idSuffix}: ${escapedText}]`
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
  for (const marker of findInlineAnnotationMarkers(markdown)) {
    if (!marker.legacyFootnote || definitions.has(marker.index)) {
      refs.push({ type: marker.type, index: marker.index })
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

  const normalized = replaceInlineAnnotationMarkers(body, (marker) => {
    const nextIndex = mapping.get(`${marker.type}:${marker.index}`) ?? marker.index
    const text = marker.legacyFootnote ? definitions.get(marker.index) ?? "" : marker.text
    return annotationSigil(marker.type, nextIndex, text, marker.id)
  })

  return canonicalizeControlledMarkdown(normalized.trimEnd())
}

export const getMarkdownFootnotes = (markdown: string): MarkdownAnnotation[] => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const controlled = scanControlledAnnotations(normalized).annotations.map((annotation) => ({
    id: annotation.id,
    type: annotation.type,
    index: annotation.index,
    text: annotation.comment,
    anchor_text: annotation.anchorText,
    anchor_start: annotation.anchorStart,
    anchor_end: annotation.anchorEnd,
    source_start: annotation.sourceStart,
    source_end: annotation.sourceEnd,
  }))
  const compatibility = findInlineAnnotationMarkers(normalized)
    .filter((marker) => !marker.legacyFootnote)
    .map((marker) => ({
      ...(marker.id ? { id: marker.id } : {}),
      type: marker.type,
      index: marker.index,
      text: marker.text,
      anchor_text: "",
      anchor_start: marker.start,
      anchor_end: marker.start,
      source_start: marker.start,
      source_end: marker.end,
    }))
  const annotations = [...controlled, ...compatibility].sort(
    (a, b) => a.source_start - b.source_start,
  )

  const claimedAnchors = new Set(
    annotations
      .filter((annotation) => annotation.anchor_text)
      .map((annotation) => `${annotation.anchor_start}:${annotation.anchor_end}`),
  )
  const maxHighlightIndex = annotations
    .filter((annotation) => annotation.type === "highlight")
    .reduce((max, annotation) => Math.max(max, annotation.index), 0)
  const standaloneHighlights: MarkdownAnnotation[] = []
  const highlightPattern = /==([^=\n]+)==/g

  for (const match of normalized.matchAll(highlightPattern)) {
    const rawStart = match.index
    const anchorStart = rawStart + 2
    const anchorEnd = anchorStart + match[1].length
    if (claimedAnchors.has(`${anchorStart}:${anchorEnd}`)) continue

    standaloneHighlights.push({
      id: `highlight-${rawStart}`,
      standalone: true,
      type: "highlight",
      index: maxHighlightIndex + standaloneHighlights.length + 1,
      text: "",
      anchor_text: match[1],
      anchor_start: anchorStart,
      anchor_end: anchorEnd,
      source_start: anchorStart,
      source_end: anchorEnd,
    })
  }

  return [...annotations, ...standaloneHighlights]
}

export const appendMarkdownFootnote = (
  markdown: string,
  note: string,
  anchorStart?: number,
  anchorEnd?: number,
) => {
  if (
    anchorStart == null ||
    anchorEnd == null ||
    anchorStart < 0 ||
    anchorEnd <= anchorStart ||
    markdown.slice(anchorStart, anchorEnd).includes("\n")
  ) {
    return markdown
  }
  const anchor = markdown.slice(anchorStart, anchorEnd)
  const replacement = formatCanonicalAnnotation({
    id: crypto.randomUUID(),
    type: "footnote",
    comment: note.trim(),
    anchorMarkdown: anchor,
  })
  return normalizeMarkdownFootnotes(
    `${markdown.slice(0, anchorStart)}${replacement}${markdown.slice(anchorEnd)}`,
  )
}

const markerMatchesIdentity = (
  marker: ReturnType<typeof findInlineAnnotationMarkers>[number],
  target: AnnotationIdentity,
) =>
  target.id
    ? marker.id === target.id
    : marker.type === target.type && marker.index === target.index

export const updateMarkdownAnnotation = (
  markdown: string,
  target: AnnotationIdentity,
  text: string,
): MarkdownAnnotationMutationResult => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const annotation = scanControlledAnnotations(normalized).annotations.find((entry) =>
    target.id ? entry.id === target.id : entry.type === target.type && entry.index === target.index,
  )
  if (!annotation) {
    let found = false
    const changed = replaceInlineAnnotationMarkers(normalized, (marker) => {
      if (marker.legacyFootnote || !markerMatchesIdentity(marker, target)) return marker.raw
      found = true
      return annotationSigil(marker.type, marker.index, text, marker.id)
    })
    return { found, markdown: found ? changed : markdown }
  }
  const replacement = formatCanonicalAnnotation({
    ...annotation,
    comment: text.trim(),
  })
  return {
    found: true,
    markdown: `${normalized.slice(0, annotation.sourceStart)}${replacement}${normalized.slice(annotation.sourceEnd)}`,
  }
}

export const changeMarkdownAnnotationType = (
  markdown: string,
  target: AnnotationIdentity,
  newType: AnnotationType,
): MarkdownAnnotationMutationResult => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const annotation = scanControlledAnnotations(normalized).annotations.find((entry) =>
    target.id ? entry.id === target.id : entry.type === target.type && entry.index === target.index,
  )
  if (!annotation) {
    let found = false
    const changed = replaceInlineAnnotationMarkers(normalized, (marker) => {
      if (marker.legacyFootnote || !markerMatchesIdentity(marker, target)) return marker.raw
      found = true
      return annotationSigil(newType, marker.index, marker.text, marker.id)
    })
    return { found, markdown: found ? normalizeMarkdownFootnotes(changed) : markdown }
  }
  const replacement = formatCanonicalAnnotation({ ...annotation, type: newType })
  return {
    found: true,
    markdown: `${normalized.slice(0, annotation.sourceStart)}${replacement}${normalized.slice(annotation.sourceEnd)}`,
  }
}

export const removeMarkdownAnnotation = (
  markdown: string,
  target: AnnotationIdentity,
): MarkdownAnnotationMutationResult => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const annotation = scanControlledAnnotations(normalized).annotations.find((entry) =>
    target.id ? entry.id === target.id : entry.type === target.type && entry.index === target.index,
  )
  if (!annotation) {
    let found = false
    const changed = replaceInlineAnnotationMarkers(normalized, (marker) => {
      if (marker.legacyFootnote || !markerMatchesIdentity(marker, target)) return marker.raw
      found = true
      return ""
    })
    return { found, markdown: found ? normalizeMarkdownFootnotes(changed).trimEnd() : markdown }
  }
  return {
    found: true,
    markdown: `${normalized.slice(0, annotation.sourceStart)}${annotation.anchorMarkdown}${normalized.slice(annotation.sourceEnd)}`.trimEnd(),
  }
}

const resolveMarkdownStandaloneHighlight = (
  markdown: string,
  target: MarkdownHighlightIdentity,
) => {
  const expectedRawStart = target.id?.startsWith("highlight-")
    ? Number(target.id.slice("highlight-".length))
    : null
  const highlightPattern = /==([^=\n]+)==/g

  for (const match of markdown.matchAll(highlightPattern)) {
    const rawStart = match.index
    const anchorStart = rawStart + 2
    const anchorEnd = anchorStart + match[1].length
    if (expectedRawStart != null && Number.isFinite(expectedRawStart)) {
      if (rawStart === expectedRawStart && match[1] === target.anchor_text) {
        return { rawStart, rawEnd: anchorEnd + 2, anchorStart, anchorEnd }
      }
      continue
    }
    if (
      match[1] === target.anchor_text &&
      (target.anchor_start == null || target.anchor_start === anchorStart) &&
      (target.anchor_end == null || target.anchor_end === anchorEnd)
    ) {
      return { rawStart, rawEnd: anchorEnd + 2, anchorStart, anchorEnd }
    }
  }

  return null
}

export const annotateMarkdownStandaloneHighlight = (
  markdown: string,
  target: MarkdownHighlightIdentity,
  type: AnnotationType,
  text: string,
  id: string,
): MarkdownAnnotationMutationResult => {
  const resolved = resolveMarkdownStandaloneHighlight(markdown, target)
  if (!resolved) return { found: false, markdown }

  const nextIndex =
    getMarkdownFootnotes(markdown)
      .filter((annotation) => annotation.type === type && !annotation.standalone)
      .reduce((max, annotation) => Math.max(max, annotation.index), 0) + 1
  void nextIndex
  const marker = formatCanonicalAnnotation({
    id,
    type,
    comment: text.trim(),
    anchorMarkdown: target.anchor_text,
  })
  return {
    found: true,
    markdown: `${markdown.slice(0, resolved.rawStart)}${marker}${markdown.slice(resolved.rawEnd)}`,
  }
}

export const removeMarkdownStandaloneHighlight = (
  markdown: string,
  target: MarkdownHighlightIdentity,
): MarkdownAnnotationMutationResult => {
  const resolved = resolveMarkdownStandaloneHighlight(markdown, target)
  if (!resolved) return { found: false, markdown }

  return {
    found: true,
    markdown: `${markdown.slice(0, resolved.rawStart)}${target.anchor_text}${markdown.slice(resolved.rawEnd)}`,
  }
}

export const updateMarkdownFootnote = (markdown: string, index: number, note: string) =>
  updateMarkdownAnnotation(markdown, { type: "footnote", index }, note).markdown

export const removeMarkdownFootnote = (markdown: string, index: number) =>
  removeMarkdownAnnotation(markdown, { type: "footnote", index }).markdown

export const extractAiAnnotationsFromMarkdown = (markdown: string): string => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const controlled = scanControlledAnnotations(normalized).annotations
    .filter((annotation) => annotation.type === "ai")
    .map((annotation) => `"${annotation.anchorText}" — ${annotation.comment}`)
  const compatibility = findInlineAnnotationMarkers(normalized)
    .filter((marker) => !marker.legacyFootnote && marker.type === "ai")
    .map((marker) => marker.raw)
  return [...controlled, ...compatibility].join("\n")
}

export const buildAiAnnotationCopy = (
  markdown: string,
): { annotationsOnly: string; fullText: string } => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const annotationsOnly = extractAiAnnotationsFromMarkdown(normalized)
  const annotations = scanControlledAnnotations(normalized).annotations
  const controlledProjection = [...annotations]
    .sort((a, b) => b.sourceStart - a.sourceStart)
    .reduce((result, annotation) => {
      const replacement =
        annotation.type === "ai"
          ? formatCanonicalAnnotation(annotation)
          : annotation.anchorMarkdown
      return `${result.slice(0, annotation.sourceStart)}${replacement}${result.slice(annotation.sourceEnd)}`
    }, normalized)
  const aiOnlyMarkdown = replaceInlineAnnotationMarkers(controlledProjection, (marker) =>
    marker.type === "personal" || marker.type === "highlight" ? "" : marker.raw,
  ).trimEnd()

  return {
    annotationsOnly: `${AI_ANNOTATIONS_ONLY_PREFIX}\n\n${annotationsOnly}`,
    fullText: `${ANNOTATION_NOTATION_COMMENT}\n\n${aiOnlyMarkdown}`,
  }
}

export type WritingAnnotationNode = {
  id: string
  standalone?: boolean
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
    const type = (node.attrs?.type as AnnotationType) ?? "footnote"
    const index = Number(node.attrs?.index ?? 0)
    result.push({
      id: String(node.attrs?.id ?? `${type}:${index}`),
      type,
      index,
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
      const highlightMark = child.marks?.find((mark) => mark.type === "highlight")
      const isStandaloneHighlight = highlightMark && highlightMark.attrs?.annotationType == null
      if (child.type === "text" && isStandaloneHighlight) {
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

export const extractRichEditorAnnotations = (editor: Editor): WritingAnnotationNode[] => {
  const annotations = extractWritingAnnotationNodes(editor.getJSON())
  const highlightMarkType = editor.schema.marks.highlight
  if (!highlightMarkType) return annotations

  const annotationRanges: Array<{ from: number; to: number }> = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "annotationReference" || node.type.name === "footnoteReference") {
      annotationRanges.push({ from: pos, to: pos + node.nodeSize })
    }
  })

  const maxAnnotationHighlightIndex = annotations
    .filter((annotation) => annotation.type === "highlight")
    .reduce((max, annotation) => Math.max(max, annotation.index), 0)
  const standaloneHighlights: WritingAnnotationNode[] = []
  const visitedRanges = new Set<string>()

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "text") return
    const highlightMark = node.marks.find((mark) => mark.type.name === "highlight")
    if (!highlightMark || highlightMark.attrs.annotationType != null) return

    const range = getMarkRange(editor.state.doc.resolve(pos), highlightMarkType)
    if (!range) return

    const key = `${range.from}-${range.to}`
    if (visitedRanges.has(key)) return
    visitedRanges.add(key)

    const hasAdjacentAnnotation = annotationRanges.some(
      (annotationRange) =>
        (annotationRange.from >= range.from && annotationRange.to <= range.to) ||
        (annotationRange.from >= range.from && annotationRange.from <= range.to + 1),
    )
    if (hasAdjacentAnnotation) return

    standaloneHighlights.push({
      type: "highlight",
      index: maxAnnotationHighlightIndex + standaloneHighlights.length + 1,
      text: "",
      id: `highlight-${standaloneHighlights.length}`,
      standalone: true,
      anchor_text: editor.state.doc.textBetween(range.from, range.to),
      anchor_start: range.from,
      anchor_end: range.to,
    })
  })

  return [...annotations, ...standaloneHighlights]
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      addFootnote: (text: string) => ReturnType
      addAnnotation: (type: AnnotationType, text: string, id?: string) => ReturnType
      updateFootnote: (index: number, text: string) => ReturnType
      updateAnnotation: (type: AnnotationType, index: number, text: string, id?: string) => ReturnType
      updateAnnotationType: (type: AnnotationType, index: number, newType: AnnotationType, newText?: string, id?: string) => ReturnType
      deleteFootnote: (index: number) => ReturnType
      deleteAnnotation: (type: AnnotationType, index: number, id?: string) => ReturnType
    }
  }
}

export const FootnoteExtension = Extension.create({
  name: "footnote",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          const seen = new Set<string>()
          const duplicates: Array<{ pos: number; id: string }> = []
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "annotationReference" && node.type.name !== "footnoteReference") {
              return
            }
            const id = String(node.attrs.id ?? "")
            if (!id || seen.has(id)) duplicates.push({ pos, id })
            else seen.add(id)
          })
          if (duplicates.length === 0) return null

          const tr = newState.tr
          const highlightMarkType = newState.schema.marks.highlight
          for (const duplicate of duplicates) {
            const node = tr.doc.nodeAt(duplicate.pos)
            if (!node) continue
            let nextId = crypto.randomUUID()
            let attempts = 0
            while (seen.has(nextId) && attempts < 4) {
              nextId = crypto.randomUUID()
              attempts += 1
            }
            if (seen.has(nextId)) {
              let suffix = 2
              nextId = `${duplicate.id || "annotation"}-copy-${suffix}`
              while (seen.has(nextId)) {
                suffix += 1
                nextId = `${duplicate.id || "annotation"}-copy-${suffix}`
              }
            }
            seen.add(nextId)
            tr.setNodeMarkup(duplicate.pos, undefined, { ...node.attrs, id: nextId })
            if (highlightMarkType) {
              stampHighlightBeforeRef(
                tr,
                duplicate.pos,
                highlightMarkType,
                (node.attrs.type as AnnotationType | undefined) ?? "footnote",
                nextId,
                String(node.attrs.text ?? ""),
              )
            }
          }
          return tr.docChanged ? tr : null
        },
      }),
    ]
  },

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

          const { from: selectionFrom, to: selectionTo } = tr.selection
          if (selectionFrom >= selectionTo) return false
          const highlightMarkType = editor.schema.marks.highlight
          const insertPos = highlightMarkType
            ? resolveAnnotationInsertPos(tr, selectionFrom, selectionTo, highlightMarkType)
            : selectionTo
          const nodeType =
            editor.schema.nodes.annotationReference ?? editor.schema.nodes.footnoteReference
          if (!nodeType) return false

          const refNode = nodeType.create({
            id: uniqueAnnotationId(editor),
            type: "footnote",
            index: nextIndex,
            text: trimmedText,
          })
          if (highlightMarkType && selectionFrom < insertPos) {
            const annotationId = String(refNode.attrs.id)
            tr.removeMark(selectionFrom, insertPos, highlightMarkType)
            tr.addMark(
              selectionFrom,
              insertPos,
              highlightMarkType.create({
                annotationId,
                annotationType: "footnote",
                annotationComment: trimmedText,
              }),
            )
          }
          tr.setSelection(TextSelection.create(tr.doc, insertPos))
          tr.insert(insertPos, refNode)

          if (dispatch) dispatch(tr)
          return true
        },

      addAnnotation:
        (type: AnnotationType, text: string, id?: string) =>
        ({ editor, tr, dispatch }) => {
          const trimmedText = text.trim()
          if (!trimmedText && type !== "highlight") return false

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

          const { from: selectionFrom, to: selectionTo } = tr.selection
          const nodeType =
            editor.schema.nodes.annotationReference ?? editor.schema.nodes.footnoteReference
          if (!nodeType) return false

          const annotationId = uniqueAnnotationId(editor, id)
          const refNode = nodeType.create({
            id: annotationId,
            type,
            index: maxIndex + 1,
            text: trimmedText,
          })
          const highlightMarkType = editor.schema.marks.highlight
          const insertPos = highlightMarkType
            ? resolveAnnotationInsertPos(tr, selectionFrom, selectionTo, highlightMarkType)
            : selectionTo
          if (highlightMarkType) {
            if (selectionFrom < insertPos) {
              tr.removeMark(selectionFrom, insertPos, highlightMarkType)
              tr.addMark(
                selectionFrom,
                insertPos,
                highlightMarkType.create({
                  annotationId,
                  annotationType: type,
                  annotationComment: trimmedText,
                }),
              )
            } else {
              stampHighlightBeforeRef(
                tr,
                insertPos,
                highlightMarkType,
                type,
                annotationId,
                trimmedText,
              )
            }
          }
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
            const nextText = text.trim()
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, text: nextText })
            const highlightMarkType = editor.schema.marks.highlight
            if (highlightMarkType) {
              stampHighlightBeforeRef(
                tr,
                pos,
                highlightMarkType,
                "footnote",
                String(node.attrs.id ?? ""),
                nextText,
              )
            }
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
        (type: AnnotationType, index: number, text: string, id?: string) =>
        ({ editor, tr, dispatch }) => {
          const positions: number[] = []
          editor.state.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (id
                ? String(node.attrs.id ?? "") === id
                : (node.attrs.type as AnnotationType | undefined) === type &&
                  (node.attrs.index as number) === index)
            ) {
              positions.push(pos)
            }
          })
          if (!positions.length) return false
          for (const pos of positions) {
            const node = editor.state.doc.nodeAt(pos)
            if (node) {
              const nextText = text.trim()
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, text: nextText })
              const highlightMarkType = editor.schema.marks.highlight
              if (highlightMarkType) {
                stampHighlightBeforeRef(
                  tr,
                  pos,
                  highlightMarkType,
                  (node.attrs.type as AnnotationType | undefined) ?? type,
                  String(node.attrs.id ?? id ?? ""),
                  nextText,
                )
              }
            }
          }
          if (dispatch) dispatch(tr)
          return true
        },

      updateAnnotationType:
        (type: AnnotationType, index: number, newType: AnnotationType, newText?: string, id?: string) =>
        ({ editor, tr, dispatch }) => {
          const positions: number[] = []
          editor.state.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (id
                ? String(node.attrs.id ?? "") === id
                : (node.attrs.type as AnnotationType | undefined) === type &&
                  (node.attrs.index as number) === index)
            ) {
              positions.push(pos)
            }
          })
          if (!positions.length) return false
          for (const pos of positions) {
            const node = editor.state.doc.nodeAt(pos)
            if (node) {
              const nextText = newText !== undefined ? newText.trim() : (node.attrs.text as string) ?? ""
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, type: newType, text: nextText })
              const highlightMarkType = editor.schema.marks.highlight
              if (highlightMarkType) {
                stampHighlightBeforeRef(
                  tr,
                  pos,
                  highlightMarkType,
                  newType,
                  String(node.attrs.id ?? id ?? ""),
                  nextText,
                )
              }
            }
          }
          // Reindex all nodes of newType to ensure unique sequential indices
          const reindexTargets: { pos: number; currentIndex: number }[] = []
          tr.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (node.attrs.type as AnnotationType | undefined) === newType
            ) {
              reindexTargets.push({ pos, currentIndex: node.attrs.index as number })
            }
          })
          reindexTargets.sort((a, b) => a.pos - b.pos)
          for (let i = 0; i < reindexTargets.length; i++) {
            const newIndex = i + 1
            const { pos, currentIndex } = reindexTargets[i]
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

      deleteAnnotation:
        (type: AnnotationType, index: number, id?: string) =>
        ({ editor, tr, dispatch }) => {
          const positions: { pos: number; size: number }[] = []
          editor.state.doc.descendants((node, pos) => {
            if (
              (node.type.name === "annotationReference" || node.type.name === "footnoteReference") &&
              (id
                ? String(node.attrs.id ?? "") === id
                : (node.attrs.type as AnnotationType | undefined) === type &&
                  (node.attrs.index as number) === index)
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
