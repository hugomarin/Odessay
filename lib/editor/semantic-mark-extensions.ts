import { Extension, Mark, getMarkRange, type Editor } from "@tiptap/core"
import type { Slice } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { escapeControlledAttribute } from "@/lib/document-components/entities"
import {
  applyEntityMark,
  applySemanticHighlight,
  createSemanticEntityId,
  ENTITY_MARK_NAME,
  removeEntityMark,
  removeSemanticHighlight,
  SEMANTIC_HIGHLIGHT_MARK_NAME,
} from "@/lib/editor/semantic-marks"

const ENTITY_SOURCE_WRITING_ID_ATTRIBUTE = "data-entity-source-writing-id"

const decodeDataAttribute = (value: string | null) => {
  if (!value) return ""
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function selectionContainsEntity(slice: Slice): boolean {
  let containsEntity = false
  slice.content.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === ENTITY_MARK_NAME)) {
      containsEntity = true
    }
  })
  return containsEntity
}

function copyEntityClipboard(view: EditorView, event: ClipboardEvent, writingId: string | null): boolean {
  if (!writingId || !event.clipboardData) return false

  const slice = view.state.selection.content()
  if (!selectionContainsEntity(slice)) return false

  const serialized = view.serializeForClipboard(slice)
  const clipboardRoot = view.dom.ownerDocument.createElement("div")
  clipboardRoot.append(serialized.dom)
  for (const entity of clipboardRoot.querySelectorAll<HTMLElement>("mark[data-entity-id]")) {
    entity.setAttribute(ENTITY_SOURCE_WRITING_ID_ATTRIBUTE, writingId)
  }

  event.clipboardData.setData("text/html", clipboardRoot.innerHTML)
  event.clipboardData.setData("text/plain", serialized.text)
  event.preventDefault()
  return true
}

export const EntityMark = Mark.create({
  name: ENTITY_MARK_NAME,
  // Higher than the Link mark (1000) so the schema rank keeps the canonical
  // chain open order: Annotation → Entity → Highlight → native marks.
  priority: 2000,
  inclusive: false,

  addOptions() {
    return {
      // Reading renderers project the type only: stable IDs and internal refs
      // never reach shared/public surfaces (surface-projections.md).
      exposeIdentity: true,
      getEntityPasteWritingId: () => null as string | null,
    }
  },

  addProseMirrorPlugins() {
    const getWritingId = this.options.getEntityPasteWritingId
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            copy: (view, event) => copyEntityClipboard(view, event, getWritingId()),
            cut: (view, event) => {
              if (!copyEntityClipboard(view, event, getWritingId())) return false
              view.dispatch(view.state.tr.deleteSelection())
              return true
            },
          },
          transformPastedHTML: (html, view) => {
            if (!html.includes("data-entity-id")) return html

            const destinationWritingId = getWritingId()
            const pasteRoot = view.dom.ownerDocument.createElement("div")
            pasteRoot.innerHTML = html
            const remappedIds = new Map<string, string>()

            for (const entity of pasteRoot.querySelectorAll<HTMLElement>("mark[data-entity-id]")) {
              const sourceWritingId = entity.getAttribute(ENTITY_SOURCE_WRITING_ID_ATTRIBUTE)
              entity.removeAttribute(ENTITY_SOURCE_WRITING_ID_ATTRIBUTE)

              const entityId = decodeDataAttribute(entity.getAttribute("data-entity-id"))
              if (!entityId || (sourceWritingId && sourceWritingId === destinationWritingId)) continue

              const identityKey = `${sourceWritingId ?? "external"}\u0000${entityId}`
              let nextEntityId = remappedIds.get(identityKey)
              if (!nextEntityId) {
                nextEntityId = createSemanticEntityId()
                remappedIds.set(identityKey, nextEntityId)
              }
              entity.setAttribute("data-entity-id", encodeURIComponent(nextEntityId))
            }

            return pasteRoot.innerHTML
          },
        },
      }),
    ]
  },

  addAttributes() {
    return {
      entityId: {
        default: null,
        parseHTML: (element) => decodeDataAttribute(element.getAttribute("data-entity-id")) || null,
        renderHTML: (attributes) => {
          const entityId = attributes.entityId
          return entityId ? { "data-entity-id": encodeURIComponent(String(entityId)) } : {}
        },
      },
      entityType: {
        default: "",
        parseHTML: (element) => decodeDataAttribute(element.getAttribute("data-entity-type")),
        renderHTML: (attributes) => {
          const entityType = attributes.entityType
          return entityType ? { "data-entity-type": encodeURIComponent(String(entityType)) } : {}
        },
      },
      entityRef: {
        default: null,
        parseHTML: (element) => decodeDataAttribute(element.getAttribute("data-entity-ref")) || null,
        renderHTML: (attributes) => {
          const entityRef = attributes.entityRef
          return entityRef ? { "data-entity-ref": encodeURIComponent(String(entityRef)) } : {}
        },
      },
    }
  },

  parseHTML() {
    return [
      { tag: "mark[data-entity-id]", priority: 100 },
      { tag: "mark[data-entity-type]", priority: 100 },
    ]
  },

  renderHTML({ mark, HTMLAttributes }) {
    const attributes: Record<string, string> = {
      "data-entity-type": encodeURIComponent(String(mark.attrs.entityType ?? "")),
    }
    if (this.options.exposeIdentity) {
      if (mark.attrs.entityId) attributes["data-entity-id"] = encodeURIComponent(String(mark.attrs.entityId))
      if (mark.attrs.entityRef) attributes["data-entity-ref"] = encodeURIComponent(String(mark.attrs.entityRef))
    }
    return ["mark", { ...HTMLAttributes, ...attributes }, 0]
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: Record<string, unknown> }) => {
            const id = escapeControlledAttribute(String(mark.attrs.entityId ?? ""))
            const type = escapeControlledAttribute(String(mark.attrs.entityType ?? ""))
            const ref = String(mark.attrs.entityRef ?? "")
            return `<Entity id="${id}" type="${type}"${ref ? ` ref="${escapeControlledAttribute(ref)}"` : ""}>`
          },
          close: "</Entity>",
        },
      },
    }
  },
})

export const SemanticHighlightMark = Mark.create({
  name: SEMANTIC_HIGHLIGHT_MARK_NAME,
  // Sits after EntityMark (2000) but before the native marks.
  priority: 1500,
  inclusive: false,

  addAttributes() {
    return {
      highlightColor: {
        default: null,
        parseHTML: (element) => decodeDataAttribute(element.getAttribute("data-highlight-color")) || null,
        renderHTML: (attributes) => {
          const highlightColor = attributes.highlightColor
          return highlightColor
            ? { "data-highlight-color": encodeURIComponent(String(highlightColor)) }
            : {}
        },
      },
    }
  },

  parseHTML() {
    return [
      { tag: "mark[data-highlight-color]", priority: 100 },
      { tag: "mark[data-semantic-highlight]", priority: 100 },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      { ...HTMLAttributes, "data-semantic-highlight": "true" },
      0,
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: Record<string, unknown> }) => {
            const color = String(mark.attrs.highlightColor ?? "")
            return `<Highlight${color ? ` color="${escapeControlledAttribute(color)}"` : ""}>`
          },
          close: "</Highlight>",
        },
      },
    }
  },
})

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    semanticMarks: {
      applyEntity: (attributes?: { id?: string; type?: string; ref?: string }) => ReturnType
      updateEntityAttributes: (attributes: { type?: string; ref?: string }) => ReturnType
      unsetEntity: () => ReturnType
      applyHighlight: (attributes?: { color?: string }) => ReturnType
      unsetHighlightSemantic: () => ReturnType
    }
  }
}

export const SemanticMarkCommands = Extension.create({
  name: "semanticMarkCommands",

  addCommands() {
    return {
      applyEntity:
        (attributes = {}) =>
        ({ editor, state }) => {
          const { from, to } = state.selection
          return applyEntityMark(editor, {
            from,
            to,
            id: attributes.id,
            type: attributes.type ?? "other",
            ref: attributes.ref,
          }).ok
        },
      updateEntityAttributes:
        (attributes) =>
        ({ editor, state }) => {
          const { from } = state.selection
          const existing = collectEntityAt(editor, from)
          if (!existing) return false
          return applyEntityMark(editor, {
            from: existing.from,
            to: existing.to,
            id: existing.entityId,
            type: attributes.type ?? existing.entityType,
            ref: attributes.ref ?? existing.entityRef ?? undefined,
          }).ok
        },
      unsetEntity: () => ({ editor }) => removeEntityMark(editor).ok,
      applyHighlight:
        (attributes = {}) =>
        ({ editor, state }) => {
          const { from, to } = state.selection
          return applySemanticHighlight(editor, {
            from,
            to,
            color: attributes.color ?? "amber",
          }).ok
        },
      unsetHighlightSemantic: () => ({ editor }) => removeSemanticHighlight(editor).ok,
    }
  },
})

const collectEntityAt = (editor: Editor, position: number) => {
  const doc = editor.state.doc
  const $pos = doc.resolve(position)
  const node = doc.nodeAt($pos.pos)
  const mark = node?.marks.find((candidate) => candidate.type.name === ENTITY_MARK_NAME)
  if (!mark) return null
  const range = getMarkRange($pos, mark.type, mark.attrs)
  if (!range) return null
  return {
    from: range.from,
    to: range.to,
    entityId: String(mark.attrs.entityId ?? ""),
    entityType: String(mark.attrs.entityType ?? ""),
    entityRef: (mark.attrs.entityRef as string | null) ?? null,
  }
}

export const semanticMarkExtensions = [EntityMark, SemanticHighlightMark, SemanticMarkCommands]
