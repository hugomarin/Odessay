import { getMarkRange, type Editor } from "@tiptap/core"
import type { Mark as ProseMirrorMark } from "@tiptap/pm/model"
import { DocumentComponentSpecRegistry } from "@/lib/document-components/registry"

export const ENTITY_MARK_NAME = "entity"
export const SEMANTIC_HIGHLIGHT_MARK_NAME = "semanticHighlight"

export const ENTITY_TYPES = [
  "person",
  "company",
  "organization",
  "place",
  "event",
  "product",
  "other",
] as const

export type EntityTypeName = (typeof ENTITY_TYPES)[number]

export const HIGHLIGHT_COLORS = ["amber", "green", "indigo", "slate"] as const

export type HighlightColorName = (typeof HIGHLIGHT_COLORS)[number]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColorName = "amber"

/**
 * Canonical nesting order, outermost to innermost. ProtectedText ships with
 * ODE-534 and reserves slot 0. The `highlight` entry is the annotation mark,
 * which is a semantic `Annotation` only while it carries an annotation id.
 */
const SEMANTIC_NESTING_ORDER: Record<string, number> = {
  protectedText: 0,
  highlight: 1,
  entity: 2,
  [SEMANTIC_HIGHLIGHT_MARK_NAME]: 3,
}

const semanticKindOfMark = (mark: ProseMirrorMark): string | null => {
  if (mark.type.name === ENTITY_MARK_NAME || mark.type.name === SEMANTIC_HIGHLIGHT_MARK_NAME) {
    return mark.type.name
  }
  if (mark.type.name === "highlight" && mark.attrs.annotationId != null) {
    return "highlight"
  }
  return null
}

export type SemanticMarkRange = {
  kind: string
  from: number
  to: number
  mark: ProseMirrorMark
}

const collectSemanticMarkRanges = (
  editor: Editor,
  from: number,
  to: number,
): SemanticMarkRange[] => {
  const ranges: SemanticMarkRange[] = []
  const visited = new Set<string>()
  const doc = editor.state.doc
  const bounds = { start: Math.max(0, from - 1), end: Math.min(doc.content.size, to + 1) }

  doc.nodesBetween(bounds.start, bounds.end, (node, pos) => {
    if (!node.isText) return
    for (const mark of node.marks) {
      const kind = semanticKindOfMark(mark)
      if (!kind) continue
      const markType = doc.type.schema.marks[mark.type.name]
      if (!markType) continue
      const range = getMarkRange(doc.resolve(pos), markType, mark.attrs)
      if (!range) continue
      const key = `${kind}:${range.from}:${range.to}`
      if (visited.has(key)) continue
      visited.add(key)
      ranges.push({ kind, from: range.from, to: range.to, mark })
    }
  })

  return ranges
}

export type SemanticApplyDecision =
  | { ok: true }
  | { ok: false; message: string }

const MESSAGES = {
  emptySelection: "Select some text first.",
  crossingBlocks: "Entity and Highlight must stay inside one paragraph.",
  crossingSemantic: "This selection would cross an existing semantic mark.",
  incompatibleNesting: "This nesting breaks the canonical semantic order.",
  invalidEntity: "An entity needs an ID and a type.",
  conflictingEntity: "An entity with this ID already exists with different metadata.",
} as const

const validOneBlockRange = (editor: Editor, from: number, to: number): boolean => {
  const $from = editor.state.doc.resolve(from)
  const $to = editor.state.doc.resolve(to)
  if (!$from.sameParent($to)) return false
  return $from.parent.isTextblock
}

type NestingPlan = { ok: true; from: number; to: number } | { ok: false; message: string }

/**
 * Validates the selection against existing semantic ranges and resolves the
 * effective mutation range. Same-kind ranges nested inside the selection
 * merge into the applied attributes; a same-kind range containing the
 * selection edits the whole mark. True crossings are rejected before any
 * mutation happens.
 */
const resolveSemanticNesting = (
  ranges: SemanticMarkRange[],
  from: number,
  to: number,
  kind: string,
): NestingPlan => {
  const order = SEMANTIC_NESTING_ORDER[kind] ?? Number.NaN
  let effective = { from, to }

  for (const range of ranges) {
    if (range.kind === kind) {
      if (range.from === from && range.to === to) continue
      if (range.from >= from && range.to <= to) continue
      if (range.from <= from && range.to >= to) {
        effective = { from: range.from, to: range.to }
        continue
      }
      return { ok: false, message: MESSAGES.crossingSemantic }
    }

    const containsSelection = range.from <= from && range.to >= to
    const insideSelection = range.from >= from && range.to <= to
    if (containsSelection && insideSelection) continue

    if (containsSelection) {
      if ((SEMANTIC_NESTING_ORDER[range.kind] ?? Number.NaN) >= order) {
        return { ok: false, message: MESSAGES.incompatibleNesting }
      }
      continue
    }

    if (insideSelection) {
      if (order >= (SEMANTIC_NESTING_ORDER[range.kind] ?? Number.NaN)) {
        return { ok: false, message: MESSAGES.incompatibleNesting }
      }
      continue
    }

    return { ok: false, message: MESSAGES.crossingSemantic }
  }

  return { ok: true, ...effective }
}

const conflictingEntityExists = (
  editor: Editor,
  id: string,
  type: string,
  ref: string,
): boolean => {
  let conflict = false
  editor.state.doc.descendants((node) => {
    if (conflict || !node.isText) return
    for (const mark of node.marks) {
      if (mark.type.name !== ENTITY_MARK_NAME || mark.attrs.entityId !== id) continue
      if (mark.attrs.entityType !== type || (mark.attrs.entityRef ?? "") !== ref) {
        conflict = true
      }
      return
    }
  })
  return conflict
}

export type EntityApplyInput = {
  from: number
  to: number
  id?: string
  type: string
  ref?: string
}

export type HighlightApplyInput = {
  from: number
  to: number
  color: string
}

const isValidEntityAttributes = ({ id, type, ref }: { id: string; type: string; ref?: string }) => {
  const spec = DocumentComponentSpecRegistry.get("Entity")
  if (!spec) return false
  if (id.length === 0 || type.length === 0) return false
  return Object.entries(ref ? { id, type, ref } : { id, type }).every(([name, value]) => {
    const attribute = spec.attributes.find((candidate) => candidate.name === name)
    if (!attribute) return false
    return attribute.validate?.(value) ?? true
  })
}

export const applyEntityMark = (
  editor: Editor,
  input: EntityApplyInput,
): SemanticApplyDecision => {
  const { from, to, type } = input
  if (from >= to) return { ok: false, message: MESSAGES.emptySelection }
  if (!validOneBlockRange(editor, from, to)) return { ok: false, message: MESSAGES.crossingBlocks }

  const id = input.id?.trim() || crypto.randomUUID()
  const ref = input.ref?.trim() ?? ""
  if (!isValidEntityAttributes({ id, type, ref: ref || undefined })) {
    return { ok: false, message: MESSAGES.invalidEntity }
  }

  const ranges = collectSemanticMarkRanges(editor, from, to)
  const nesting = resolveSemanticNesting(ranges, from, to, ENTITY_MARK_NAME)
  if (!nesting.ok) return { ok: false, message: nesting.message }
  if (conflictingEntityExists(editor, id, type, ref)) {
    return { ok: false, message: MESSAGES.conflictingEntity }
  }

  const markType = editor.schema.marks[ENTITY_MARK_NAME]
  if (!markType) return { ok: false, message: MESSAGES.invalidEntity }

  const transaction = editor.state.tr
  transaction.removeMark(nesting.from, nesting.to, markType)
  transaction.addMark(nesting.from, nesting.to, markType.create({
    entityId: id,
    entityType: type,
    entityRef: ref || null,
  }))
  editor.view.dispatch(transaction)
  return { ok: true }
}

export const removeEntityMark = (editor: Editor): SemanticApplyDecision => {
  const markType = editor.schema.marks[ENTITY_MARK_NAME]
  if (!markType) return { ok: false, message: MESSAGES.invalidEntity }
  const { from, to } = editor.state.selection
  const transaction = editor.state.tr
  transaction.removeMark(from, to, markType)
  editor.view.dispatch(transaction)
  return { ok: true }
}

export const applySemanticHighlight = (
  editor: Editor,
  input: HighlightApplyInput,
): SemanticApplyDecision => {
  const { from, to, color } = input
  if (from >= to) return { ok: false, message: MESSAGES.emptySelection }
  if (!validOneBlockRange(editor, from, to)) return { ok: false, message: MESSAGES.crossingBlocks }

  const ranges = collectSemanticMarkRanges(editor, from, to)
  const nesting = resolveSemanticNesting(ranges, from, to, SEMANTIC_HIGHLIGHT_MARK_NAME)
  if (!nesting.ok) return { ok: false, message: nesting.message }

  const markType = editor.schema.marks[SEMANTIC_HIGHLIGHT_MARK_NAME]
  if (!markType) return { ok: false, message: MESSAGES.crossingSemantic }

  const transaction = editor.state.tr
  transaction.removeMark(nesting.from, nesting.to, markType)
  transaction.addMark(nesting.from, nesting.to, markType.create({ highlightColor: color }))
  editor.view.dispatch(transaction)
  return { ok: true }
}

export const removeSemanticHighlight = (editor: Editor): SemanticApplyDecision => {
  const markType = editor.schema.marks[SEMANTIC_HIGHLIGHT_MARK_NAME]
  if (!markType) return { ok: false, message: MESSAGES.crossingSemantic }
  const { from, to } = editor.state.selection
  const transaction = editor.state.tr
  transaction.removeMark(from, to, markType)
  editor.view.dispatch(transaction)
  return { ok: true }
}
