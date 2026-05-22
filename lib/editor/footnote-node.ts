import { Node, mergeAttributes } from "@tiptap/core"

export const FOOTNOTE_REF_EVENT = "footnote:click"

export const ANNOTATION_TYPES = ["footnote", "personal", "ai", "collaborative"] as const

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
  type: AnnotationType
  index: number
  text: string
}

const INLINE_ANNOTATION_RE =
  /\[\^(\d+):\s*([^\]]*?)\]|\[@(p|c)?(\d+):\s*([^\]]*?)\]|\[\^(\d+)\]/g
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
  if (value === "personal" || value === "ai" || value === "collaborative" || value === "footnote") {
    return value
  }
  return "footnote"
}

const parseInlineAnnotation = (
  match: RegExpExecArray,
  legacyDefinitions: Map<number, string>,
): RawAnnotationMatch | null => {
  if (match[1]) {
    return {
      fullMatch: match[0],
      legacyFootnote: false,
      type: "footnote",
      index: Number(match[1]),
      text: match[2].trim(),
    }
  }

  if (match[4]) {
    return {
      fullMatch: match[0],
      legacyFootnote: false,
      type: match[3] === "p" ? "personal" : match[3] === "c" ? "collaborative" : "ai",
      index: Number(match[4]),
      text: match[5].trim(),
    }
  }

  if (match[6]) {
    const index = Number(match[6])
    return {
      fullMatch: match[0],
      legacyFootnote: true,
      type: "footnote",
      index,
      text: legacyDefinitions.get(index) ?? "",
    }
  }

  return null
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
          let match: RegExpExecArray | null

          INLINE_ANNOTATION_RE.lastIndex = 0

          while ((match = INLINE_ANNOTATION_RE.exec(text)) !== null) {
            const parsed = parseInlineAnnotation(match, legacyDefinitions)
            if (!parsed) {
              continue
            }

            if (match.index > lastIndex) {
              nextChildren.push({ type: "text", content: text.slice(lastIndex, match.index) })
            }

            const annotationId = crypto.randomUUID()
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

            lastIndex = match.index + parsed.fullMatch.length
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

const annotationToMarkdown = (type: AnnotationType, index: number, text: string) => {
  const trimmedText = text.trim()

  switch (type) {
    case "ai":
      return `[@${index}: ${trimmedText}]`
    case "personal":
      return `[@p${index}: ${trimmedText}]`
    case "collaborative":
      return `[@c${index}: ${trimmedText}]`
    case "footnote":
    default:
      return `[^${index}: ${trimmedText}]`
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
      }),
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
      dom.textContent = String(node.attrs.index)
      dom.style.cursor = "pointer"

      if (type === "footnote") {
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
      }

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
