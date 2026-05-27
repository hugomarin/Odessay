import { Editor } from "@tiptap/core"
import type { JSONContent } from "@tiptap/core"
import { createEditorExtensions } from "@/lib/editor/extensions"
import { serializeDocumentToMarkdown } from "@/lib/editor/document-serialization"
import { type AnnotationType } from "@/lib/editor/footnote-node"

type ApplyAnnotationInput = {
  bodyJson: JSONContent | null | undefined
  bodyText: string
  anchorStart: number
  anchorEnd: number
  type: AnnotationType
  text: string
}

type ApplyAnnotationResult = {
  bodyJson: JSONContent
  bodyText: string
  bodyMarkdown: string
}

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

const resolveTextOffset = (
  doc: Editor["state"]["doc"],
  targetOffset: number,
  preferAfter: boolean,
) => {
  let textOffset = 0
  let resolvedPos: number | null = null

  doc.descendants((node, pos) => {
    if (resolvedPos !== null) {
      return false
    }

    if (node.isText) {
      const textLength = node.text?.length ?? 0
      const nextOffset = textOffset + textLength
      const boundaryHit = preferAfter ? targetOffset <= nextOffset : targetOffset < nextOffset

      if (boundaryHit) {
        const localOffset = Math.max(0, Math.min(textLength, targetOffset - textOffset))
        resolvedPos = pos + localOffset
        return false
      }

      textOffset = nextOffset
      return
    }

    if (node.type.name === "hardBreak") {
      const nextOffset = textOffset + 1
      if (targetOffset <= nextOffset) {
        resolvedPos = preferAfter ? pos + 1 : pos
        return false
      }
      textOffset = nextOffset
    }
  })

  return resolvedPos ?? doc.content.size
}

const isAnnotationReferenceNode = (nodeName: string) =>
  nodeName === "annotationReference" || nodeName === "footnoteReference"

const findAnnotationReferencesInRange = (
  doc: Editor["state"]["doc"],
  from: number,
  to: number,
) => {
  const positions: { pos: number; size: number }[] = []

  doc.descendants((node, pos) => {
    if (isAnnotationReferenceNode(node.type.name) && pos >= from && pos <= to + 1) {
      positions.push({ pos, size: node.nodeSize })
    }
  })

  return positions
}

export const getBodyMarkdown = (bodyJson: JSONContent | null | undefined): string => {
  return serializeDocumentToMarkdown(bodyJson)
}

export const applyAnnotationToBody = ({
  bodyJson,
  bodyText,
  anchorStart,
  anchorEnd,
  type,
  text,
}: ApplyAnnotationInput): ApplyAnnotationResult => {
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: bodyJson ?? EMPTY_DOC,
  })

  try {
    const doc = editor.state.doc
    const from = resolveTextOffset(doc, anchorStart, false)
    const to = resolveTextOffset(doc, anchorEnd, true)
    if (from >= to) {
      throw new Error("Invalid annotation range.")
    }

    const nodeType = editor.schema.nodes.annotationReference ?? editor.schema.nodes.footnoteReference
    const highlightMark = editor.schema.marks.highlight
    if (!nodeType || !highlightMark) {
      throw new Error("Annotation extensions are not available.")
    }

    let maxTypeIndex = 0
    editor.state.doc.descendants((node) => {
      if (
        isAnnotationReferenceNode(node.type.name) &&
        ((node.attrs.type as AnnotationType | undefined) ?? "footnote") === type
      ) {
        maxTypeIndex = Math.max(maxTypeIndex, Number(node.attrs.index ?? 0))
      }
    })

    const tr = editor.state.tr
    const existingReferences = findAnnotationReferencesInRange(editor.state.doc, from, to)
    for (const { pos, size } of [...existingReferences].reverse()) {
      tr.delete(pos, pos + size)
    }

    const nextFrom = resolveTextOffset(tr.doc, anchorStart, false)
    const nextTo = resolveTextOffset(tr.doc, anchorEnd, true)

    tr.addMark(nextFrom, nextTo, highlightMark.create())
    tr.insert(
      nextTo,
      nodeType.create({
        id: crypto.randomUUID(),
        type,
        index: maxTypeIndex + 1,
        text: text.trim(),
      }),
    )
    editor.view.dispatch(tr)

    const nextBodyJson = editor.getJSON()
    const nextBodyText = editor.getText({ blockSeparator: "\n" }) || bodyText
    const nextMarkdown = serializeDocumentToMarkdown(nextBodyJson)

    return {
      bodyJson: nextBodyJson,
      bodyText: nextBodyText,
      bodyMarkdown: nextMarkdown,
    }
  } finally {
    editor.destroy()
  }
}
