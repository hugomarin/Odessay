import { Extension, getMarkRange } from "@tiptap/core"
import { TextSelection } from "@tiptap/pm/state"

// ---------------------------------------------------------------------------
// Markdown-only helpers (used when mode === "markdown" or for persistence)
// ---------------------------------------------------------------------------

const FOOTNOTE_REFERENCE_REGEX = /\[\^(\d+)\]/g
const FOOTNOTE_DEFINITION_REGEX = /^\[\^(\d+)\]:\s*(.*)$/gm

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const collectDefinitions = (markdown: string) => {
  const definitions = new Map<number, string>()

  for (const match of markdown.matchAll(FOOTNOTE_DEFINITION_REGEX)) {
    const index = Number(match[1])

    if (!Number.isNaN(index)) {
      definitions.set(index, match[2].trim())
    }
  }

  return definitions
}

const stripDefinitions = (markdown: string) => {
  const lines = markdown.split("\n")
  const keptLines: string[] = []

  for (const line of lines) {
    if (line.match(/^\[\^\d+\]:\s*/)) {
      continue
    }

    keptLines.push(line)
  }

  return keptLines.join("\n").trimEnd()
}

const getReferenceOrder = (markdown: string) => {
  const orderedUnique: number[] = []

  for (const match of markdown.matchAll(FOOTNOTE_REFERENCE_REGEX)) {
    const index = Number(match[1])

    if (!Number.isNaN(index) && !orderedUnique.includes(index)) {
      orderedUnique.push(index)
    }
  }

  return orderedUnique
}

const composeMarkdownWithDefinitions = (body: string, definitions: Map<number, string>) => {
  const trimmedBody = body.trimEnd()
  const orderedReferences = getReferenceOrder(trimmedBody)

  if (!orderedReferences.length) {
    return trimmedBody
  }

  const definitionLines = orderedReferences.map((reference) =>
    `[^${reference}]: ${definitions.get(reference) ?? ""}`.trimEnd(),
  )

  return `${trimmedBody}\n\n${definitionLines.join("\n")}`
}

export type MarkdownFootnote = {
  index: number
  text: string
}

const remapReferences = (markdown: string, orderedReferences: number[]) => {
  const mapping = new Map<number, number>()

  for (let index = 0; index < orderedReferences.length; index += 1) {
    mapping.set(orderedReferences[index], index + 1)
  }

  let remapped = markdown

  for (const [from, to] of mapping.entries()) {
    if (from === to) {
      continue
    }

    remapped = remapped.replaceAll(
      new RegExp(`\\[\\^${escapeRegExp(String(from))}\\]`, "g"),
      `[^__tmp_${from}__]`,
    )
  }

  for (const [from, to] of mapping.entries()) {
    if (from === to) {
      continue
    }

    remapped = remapped.replaceAll(`[^__tmp_${from}__]`, `[^${to}]`)
  }

  return { remapped, mapping }
}

export const normalizeMarkdownFootnotes = (markdown: string) => {
  const definitions = collectDefinitions(markdown)
  const body = stripDefinitions(markdown)
  const orderedReferences = getReferenceOrder(body)
  const { remapped, mapping } = remapReferences(body, orderedReferences)

  if (!orderedReferences.length) {
    return remapped.trimEnd()
  }

  const remappedDefinitions = new Map<number, string>()

  for (const originalReference of orderedReferences) {
    const remappedIndex = mapping.get(originalReference) ?? originalReference
    const definition = definitions.get(originalReference) ?? ""
    remappedDefinitions.set(remappedIndex, definition)
  }

  return composeMarkdownWithDefinitions(remapped, remappedDefinitions)
}

export const getMarkdownFootnotes = (markdown: string): MarkdownFootnote[] => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const definitions = collectDefinitions(normalized)
  const orderedReferences = getReferenceOrder(stripDefinitions(normalized))

  return orderedReferences.map((index) => ({
    index,
    text: definitions.get(index) ?? "",
  }))
}

export const appendMarkdownFootnote = (markdown: string, note: string) => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const body = stripDefinitions(normalized)
  const definitions = collectDefinitions(normalized)
  const nextIndex = getReferenceOrder(body).length + 1
  const nextBody = `${body}[^${nextIndex}]`

  definitions.set(nextIndex, note.trim())

  return composeMarkdownWithDefinitions(nextBody, definitions)
}

export const updateMarkdownFootnote = (markdown: string, index: number, note: string) => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const body = stripDefinitions(normalized)
  const definitions = collectDefinitions(normalized)

  if (!definitions.has(index)) {
    return normalized
  }

  definitions.set(index, note.trim())
  return composeMarkdownWithDefinitions(body, definitions)
}

export const removeMarkdownFootnote = (markdown: string, index: number) => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const definitions = collectDefinitions(normalized)

  if (!definitions.has(index)) {
    return normalized
  }

  definitions.delete(index)
  const bodyWithoutReference = stripDefinitions(normalized).replaceAll(`[^${index}]`, "")
  return normalizeMarkdownFootnotes(composeMarkdownWithDefinitions(bodyWithoutReference, definitions))
}

// ---------------------------------------------------------------------------
// TipTap command extension
// ---------------------------------------------------------------------------

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      addFootnote: (text: string) => ReturnType
      updateFootnote: (index: number, text: string) => ReturnType
      deleteFootnote: (index: number) => ReturnType
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

          // Count existing footnote nodes to assign the next index
          let maxIndex = 0
          editor.state.doc.descendants((node) => {
            if (node.type.name === "footnoteReference") {
              const idx = node.attrs.index as number
              if (idx > maxIndex) maxIndex = idx
            }
          })
          const nextIndex = maxIndex + 1

          // Insert node at end of current selection (without replacing selected text)
          const insertPos = editor.state.selection.to
          const nodeType = editor.schema.nodes.footnoteReference
          if (!nodeType) return false

          const refNode = nodeType.create({ index: nextIndex, text: trimmedText })
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
            if (node.type.name === "footnoteReference" && (node.attrs.index as number) === index) {
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
          // Collect positions in reverse order to avoid offset shifts
          const positions: { pos: number; size: number }[] = []

          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === "footnoteReference" && (node.attrs.index as number) === index) {
              positions.push({ pos, size: node.nodeSize })
            }
          })

          if (!positions.length) return false

          // Delete in reverse order; also remove any highlight mark on the
          // text immediately preceding each ref (the annotated anchor text).
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

          // Re-index remaining nodes so indices are sequential
          const nodePositions: { pos: number; currentIndex: number }[] = []
          const tempDoc = tr.doc
          tempDoc.descendants((node, pos) => {
            if (node.type.name === "footnoteReference") {
              nodePositions.push({ pos, currentIndex: node.attrs.index as number })
            }
          })

          // Sort by appearance order
          nodePositions.sort((a, b) => a.pos - b.pos)

          // Assign sequential indices
          const seenOriginal = new Map<number, number>()
          let nextIdx = 1
          for (const { currentIndex } of nodePositions) {
            if (!seenOriginal.has(currentIndex)) {
              seenOriginal.set(currentIndex, nextIdx++)
            }
          }

          // Apply new indices
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
    }
  },
})
