import { Node, mergeAttributes } from "@tiptap/core"
import { findInlineAnnotationMarkers } from "@/lib/editor/annotation-markdown"

export const FOOTNOTE_REF_EVENT = "footnote:click"

export const ANNOTATION_TYPES = ["footnote", "personal", "ai", "highlight"] as const

export type AnnotationType = (typeof ANNOTATION_TYPES)[number]

export type AnnotationEntry = {
  id: string
  type: AnnotationType
  index: number
  text: string
}

type RawAnnotationMatch = {
  fullMatch: string
  legacyFootnote: boolean
  id?: string
  type: AnnotationType
  index: number
  text: string
}

const FOOTNOTE_DEFINITION_LINE_RE = /^\[\^(\d+)\]:\s*(.*)$/

const escapeHtmlAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

const decodeAttribute = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const coerceAnnotationType = (value: string | null | undefined): AnnotationType => {
  if (value === "personal" || value === "ai" || value === "footnote" || value === "highlight") return value
  if (value === "collaborative") return "personal"
  return "footnote"
}

const parseInlineAnnotation = (
  marker: ReturnType<typeof findInlineAnnotationMarkers>[number],
  legacyDefinitions: Map<number, string>,
): RawAnnotationMatch | null => {
  if (marker.legacyFootnote) {
    return {
      fullMatch: marker.raw,
      legacyFootnote: true,
      type: "footnote",
      index: marker.index,
      text: legacyDefinitions.get(marker.index) ?? "",
    }
  }

  return {
    fullMatch: marker.raw,
    legacyFootnote: false,
    id: marker.id,
    type: marker.type,
    index: marker.index,
    text: marker.text,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setupMarkdownItRule(md: any) {
  md.core.ruler.push(
    "annotation_inline_ref",
    (state: {
      tokens: {
        type: string
        content: string
        children: { type: string; content: string }[] | null
      }[]
    }) => {
      const legacyDefinitions = new Map<number, string>()

      for (const blockToken of state.tokens) {
        if (blockToken.type !== "inline") continue
        for (const line of blockToken.content.split("\n")) {
          const defMatch = FOOTNOTE_DEFINITION_LINE_RE.exec(line.trim())
          if (defMatch) {
            legacyDefinitions.set(Number(defMatch[1]), defMatch[2].trim())
          }
        }
      }

      const filtered: typeof state.tokens = []
      let i = 0

      while (i < state.tokens.length) {
        const token = state.tokens[i]

        if (
          token.type === "paragraph_open" &&
          i + 1 < state.tokens.length &&
          state.tokens[i + 1].type === "inline" &&
          state.tokens[i + 1].content
            .trim()
            .split("\n")
            .filter((line) => line.trim() !== "")
            .every((line) => FOOTNOTE_DEFINITION_LINE_RE.test(line.trim()))
        ) {
          i += 3
          continue
        }

        if (token.type !== "inline" || !token.children) {
          filtered.push(token)
          i += 1
          continue
        }

        const nextChildren: typeof token.children = []

        for (const child of token.children) {
          if (child.type !== "text") {
            nextChildren.push(child)
            continue
          }

          const text = child.content
          let lastIndex = 0
          for (const marker of findInlineAnnotationMarkers(text)) {
            const parsed = parseInlineAnnotation(marker, legacyDefinitions)
            if (!parsed) {
              continue
            }

            if (marker.start > lastIndex) {
              nextChildren.push({ type: "text", content: text.slice(lastIndex, marker.start) })
            }

            const annotationId = parsed.id ?? crypto.randomUUID()
            const attrs = [
              `id="${annotationId}"`,
              `annotation-id="${annotationId}"`,
              `annotation-type="${parsed.type}"`,
              `index="${parsed.index}"`,
              `annotation-text="${escapeHtmlAttribute(encodeURIComponent(parsed.text))}"`,
            ]

            nextChildren.push({
              type: "html_inline",
              content: `<annotation-ref ${attrs.join(" ")}></annotation-ref>`,
            })

            lastIndex = marker.end
          }

          if (lastIndex === 0) {
            nextChildren.push(child)
          } else if (lastIndex < text.length) {
            nextChildren.push({ type: "text", content: text.slice(lastIndex) })
          }
        }

        token.children = nextChildren
        filtered.push(token)
        i += 1
      }

      state.tokens = filtered
    },
  )
}

const annotationToMarkdown = (type: AnnotationType, index: number, text: string, id?: string) => {
  const trimmedText = text.trim()
  const idSuffix = id ? `|${id}` : ""

  switch (type) {
    case "ai":
      return `[@${index}${idSuffix}: ${trimmedText}]`
    case "personal":
      return `[@p${index}${idSuffix}: ${trimmedText}]`
    case "highlight":
      return `[@h${index}${idSuffix}: ${trimmedText}]`
    case "footnote":
    default:
      return `[^${index}${idSuffix}: ${trimmedText}]`
  }
}

export const AnnotationReferenceNode = Node.create({
  name: "annotationReference",

  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-annotation-id") ??
          element.getAttribute("annotation-id") ??
          element.getAttribute("id") ??
          crypto.randomUUID(),
        renderHTML: (attrs) => ({
          "data-annotation-id": String(attrs.id ?? crypto.randomUUID()),
        }),
      },
      type: {
        default: "footnote",
        parseHTML: (element) =>
          coerceAnnotationType(
            element.getAttribute("data-annotation-type") ??
              element.getAttribute("annotation-type") ??
              element.getAttribute("data-footnote-type"),
          ),
        renderHTML: (attrs) => ({
          "data-annotation-type": coerceAnnotationType(String(attrs.type ?? "footnote")),
        }),
      },
      index: {
        default: null,
        parseHTML: (element) => {
          const raw =
            element.getAttribute("data-annotation-index") ??
            element.getAttribute("data-footnote-index") ??
            element.getAttribute("index")
          const parsed = Number(raw)
          return Number.isNaN(parsed) ? null : parsed
        },
        renderHTML: (attrs) => ({
          "data-annotation-index": String(attrs.index),
        }),
      },
      text: {
        default: "",
        parseHTML: (element) => {
          const encoded =
            element.getAttribute("data-annotation-text") ??
            element.getAttribute("data-footnote-text") ??
            element.getAttribute("annotation-text") ??
            element.getAttribute("note-text") ??
            ""
          return decodeAttribute(encoded)
        },
        renderHTML: (attrs) => ({
          "data-annotation-text": encodeURIComponent((attrs.text as string) ?? ""),
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: "sup[data-annotation-index]",
        getAttrs: (node) => {
          const el = node as HTMLElement
          const raw = el.getAttribute("data-annotation-index")
          const parsed = Number(raw)
          if (Number.isNaN(parsed)) return false
          return {
            id: el.getAttribute("data-annotation-id") ?? crypto.randomUUID(),
            type: coerceAnnotationType(el.getAttribute("data-annotation-type")),
            index: parsed,
            text: decodeAttribute(el.getAttribute("data-annotation-text") ?? ""),
          }
        },
      },
      {
        tag: "sup[data-footnote-index]",
        getAttrs: (node) => {
          const el = node as HTMLElement
          const raw = el.getAttribute("data-footnote-index")
          const parsed = Number(raw)
          if (Number.isNaN(parsed)) return false
          return {
            id: el.getAttribute("data-annotation-id") ?? crypto.randomUUID(),
            type: "footnote",
            index: parsed,
            text: decodeAttribute(el.getAttribute("data-footnote-text") ?? ""),
          }
        },
      },
      {
        tag: "annotation-ref",
        getAttrs: (node) => {
          const el = node as HTMLElement
          const raw = el.getAttribute("index")
          const parsed = Number(raw)
          if (Number.isNaN(parsed)) return false
          return {
            id:
              el.getAttribute("annotation-id") ??
              el.getAttribute("id") ??
              crypto.randomUUID(),
            type: coerceAnnotationType(el.getAttribute("annotation-type")),
            index: parsed,
            text: decodeAttribute(el.getAttribute("annotation-text") ?? ""),
          }
        },
      },
      {
        tag: "footnote-ref",
        getAttrs: (node) => {
          const el = node as HTMLElement
          const raw = el.getAttribute("index")
          const parsed = Number(raw)
          if (Number.isNaN(parsed)) return false
          return {
            id:
              el.getAttribute("annotation-id") ??
              el.getAttribute("id") ??
              crypto.randomUUID(),
            type: "footnote",
            index: parsed,
            text: decodeAttribute(el.getAttribute("note-text") ?? ""),
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const type = coerceAnnotationType(String(node.attrs.type ?? "footnote"))
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        class: `annotation-ref annotation-ref-${type}`,
        "data-annotation-type": type,
        style: "cursor:pointer",
      }),
      ["span", { class: "annotation-ref-icon", "aria-hidden": "true" }, "↗"],
    ]
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement("sup")
      const type = coerceAnnotationType(String(node.attrs.type ?? "footnote"))
      dom.setAttribute("data-annotation-id", String(node.attrs.id ?? crypto.randomUUID()))
      dom.setAttribute("data-annotation-type", type)
      dom.setAttribute("data-annotation-index", String(node.attrs.index))
      dom.setAttribute(
        "data-annotation-text",
        encodeURIComponent((node.attrs.text as string) ?? ""),
      )
      dom.className = `annotation-ref annotation-ref-${type}`
      dom.style.cursor = "pointer"

      const icon = document.createElement("span")
      icon.className = "annotation-ref-icon"
      icon.setAttribute("aria-hidden", "true")
      icon.textContent = "↗"
      dom.appendChild(icon)

      dom.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        const pos = typeof getPos === "function" ? getPos() : null
        dom.dispatchEvent(
          new CustomEvent(FOOTNOTE_REF_EVENT, {
            bubbles: true,
            detail: { index: node.attrs.index as number, pos },
          }),
        )
      })

      return { dom }
    }
  },

  addStorage() {
    return {
      markdown: {
        parse: {
          setup: setupMarkdownItRule,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write(
            annotationToMarkdown(
              coerceAnnotationType(node.attrs.type as string),
              Number(node.attrs.index),
              String(node.attrs.text ?? ""),
              typeof node.attrs.id === "string" ? node.attrs.id : undefined,
            ),
          )
        },
      },
    }
  },
})

export const FootnoteReferenceNode = AnnotationReferenceNode

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getEditorAnnotations(editor: { state: { doc: { descendants: (fn: any) => void } } }) {
  const seen = new Set<string>()
  const result: AnnotationEntry[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.state.doc.descendants((node: any) => {
    if (node.type.name !== "annotationReference" && node.type.name !== "footnoteReference") {
      return
    }

    const id = String(node.attrs.id ?? `${node.attrs.type ?? "footnote"}:${node.attrs.index}`)
    if (seen.has(id)) {
      return
    }

    seen.add(id)
    result.push({
      id,
      type: coerceAnnotationType(node.attrs.type as string),
      index: Number(node.attrs.index ?? 0),
      text: String(node.attrs.text ?? ""),
    })
  })

  return result.sort((a, b) => a.index - b.index)
}

export type FootnoteEntry = { type: "footnote"; index: number; text: string }

export function getEditorFootnotes(editor: { state: { doc: { descendants: (fn: (node: unknown) => void) => void } } }): FootnoteEntry[] {
  return getEditorAnnotations(editor)
    .filter((annotation) => annotation.type === "footnote")
    .map(({ index, text }) => ({ type: "footnote", index, text }))
}

export function getMarkdownWithFootnoteDefinitions(
  baseMarkdown: string,
  footnotes: FootnoteEntry[],
) {
  if (!footnotes.length) return baseMarkdown.trimEnd()

  const lines = footnotes.map(({ index, text }) => `[^${index}]: ${text}`.trimEnd())
  return `${baseMarkdown.trimEnd()}\n\n${lines.join("\n")}`
}
