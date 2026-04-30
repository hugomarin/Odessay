import { Node, mergeAttributes } from "@tiptap/core"

export const FOOTNOTE_REF_EVENT = "footnote:click"

const FOOTNOTE_REF_RE = /\[\^(\d+)\]/g
const FOOTNOTE_DEFINITION_LINE_RE = /^\[\^(\d+)\]:\s*(.*)$/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setupMarkdownItRule(md: any) {
  // Build a map of definitions from the raw markdown before rendering
  // so we can attach text to each footnote-ref node via a data attribute.
  md.core.ruler.push(
    "footnote_inline_ref",
    (state: {
      env: Record<string, string>
      tokens: {
        type: string
        content: string
        children: { type: string; content: string }[] | null
      }[]
    }) => {
      // Pass 1: collect all definitions from inline tokens.
      // A paragraph may contain multiple definitions separated by \n (one markdown paragraph)
      // so we iterate over each line rather than matching the whole content at once.
      const definitions = new Map<string, string>()

      for (const blockToken of state.tokens) {
        if (blockToken.type !== "inline") continue
        for (const line of blockToken.content.split("\n")) {
          const defMatch = FOOTNOTE_DEFINITION_LINE_RE.exec(line.trim())
          if (defMatch) {
            definitions.set(defMatch[1], defMatch[2].trim())
          }
        }
      }

      // Pass 2: process tokens
      const filtered: typeof state.tokens = []
      let i = 0

      while (i < state.tokens.length) {
        const token = state.tokens[i]

        // Remove block-level footnote definitions: paragraph_open + inline([^n]: text) + paragraph_close.
        // Handle both single-definition paragraphs and multi-definition paragraphs (lines joined by \n).
        if (
          token.type === "paragraph_open" &&
          i + 1 < state.tokens.length &&
          state.tokens[i + 1].type === "inline" &&
          state.tokens[i + 1].content
            .trim()
            .split("\n")
            .filter((l) => l.trim() !== "")
            .every((l) => FOOTNOTE_DEFINITION_LINE_RE.test(l.trim()))
        ) {
          i += 3
          continue
        }

        if (token.type !== "inline") {
          filtered.push(token)
          i++
          continue
        }

        const children = token.children
        if (!children) {
          filtered.push(token)
          i++
          continue
        }

        const nextChildren: typeof children = []

        for (const child of children) {
          if (child.type !== "text") {
            nextChildren.push(child)
            continue
          }

          const text = child.content
          let lastIndex = 0
          let match: RegExpExecArray | null

          FOOTNOTE_REF_RE.lastIndex = 0

          while ((match = FOOTNOTE_REF_RE.exec(text)) !== null) {
            if (match.index > lastIndex) {
              nextChildren.push({ type: "text", content: text.slice(lastIndex, match.index) })
            }

            const noteIndex = match[1]
            const noteText = definitions.get(noteIndex) ?? ""
            const encodedText = encodeURIComponent(noteText)

            nextChildren.push({
              type: "html_inline",
              content: `<footnote-ref index="${noteIndex}" note-text="${encodedText}"></footnote-ref>`,
            })

            lastIndex = match.index + match[0].length
          }

          if (lastIndex === 0) {
            nextChildren.push(child)
          } else if (lastIndex < text.length) {
            nextChildren.push({ type: "text", content: text.slice(lastIndex) })
          }
        }

        token.children = nextChildren
        filtered.push(token)
        i++
      }

      state.tokens = filtered
    },
  )
}

export const FootnoteReferenceNode = Node.create({
  name: "footnoteReference",

  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      index: {
        default: null,
        parseHTML: (element) => {
          const raw =
            element.getAttribute("data-footnote-index") ??
            element.getAttribute("index")
          const parsed = Number(raw)
          return Number.isNaN(parsed) ? null : parsed
        },
        renderHTML: (attrs) => ({
          "data-footnote-index": String(attrs.index),
        }),
      },
      text: {
        default: "",
        parseHTML: (element) => {
          const encoded =
            element.getAttribute("data-footnote-text") ??
            element.getAttribute("note-text") ??
            ""
          try {
            return decodeURIComponent(encoded)
          } catch {
            return encoded
          }
        },
        renderHTML: (attrs) => ({
          "data-footnote-text": encodeURIComponent((attrs.text as string) ?? ""),
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: "sup[data-footnote-index]",
        getAttrs: (node) => {
          const el = node as HTMLElement
          const raw = el.getAttribute("data-footnote-index")
          const parsed = Number(raw)
          if (Number.isNaN(parsed)) return false
          const encoded = el.getAttribute("data-footnote-text") ?? ""
          let text = ""
          try {
            text = decodeURIComponent(encoded)
          } catch {
            text = encoded
          }
          return { index: parsed, text }
        },
      },
      {
        tag: "footnote-ref",
        getAttrs: (node) => {
          const el = node as HTMLElement
          const raw = el.getAttribute("index")
          const parsed = Number(raw)
          if (Number.isNaN(parsed)) return false
          const encoded = el.getAttribute("note-text") ?? ""
          let text = ""
          try {
            text = decodeURIComponent(encoded)
          } catch {
            text = encoded
          }
          return { index: parsed, text }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { class: "footnote-ref" })]
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement("sup")
      dom.setAttribute("data-footnote-index", String(node.attrs.index))
      dom.setAttribute(
        "data-footnote-text",
        encodeURIComponent((node.attrs.text as string) ?? ""),
      )
      dom.className = "footnote-ref"
      dom.textContent = String(node.attrs.index)
      dom.style.cursor = "pointer"

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
        // Serialize: emit [^n] for the body; definitions are appended by getEditorMarkdownWithFootnotes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write(`[^${node.attrs.index}]`)
        },
      },
    }
  },
})

/**
 * Collect all footnote nodes from the editor and return {index, text}[] ordered by appearance.
 * This replaces getMarkdownFootnotes() for the Rich editor mode.
 */
export type FootnoteEntry = { index: number; text: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getEditorFootnotes(editor: { state: { doc: { descendants: (fn: any) => void } } }): FootnoteEntry[] {
  const seen = new Set<number>()
  const result: FootnoteEntry[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.state.doc.descendants((node: any) => {
    if (node.type.name === "footnoteReference") {
      const index = node.attrs.index as number
      if (!seen.has(index)) {
        seen.add(index)
        result.push({ index, text: (node.attrs.text as string) ?? "" })
      }
    }
  })

  return result.sort((a, b) => a.index - b.index)
}

/**
 * Returns the full markdown string including footnote definitions reconstructed from nodes.
 * Use this instead of getEditorMarkdown() when you need definitions for persistence.
 */
export function getMarkdownWithFootnoteDefinitions(
  baseMarkdown: string,
  footnotes: FootnoteEntry[],
): string {
  if (!footnotes.length) return baseMarkdown.trimEnd()

  const lines = footnotes.map(({ index, text }) => `[^${index}]: ${text}`.trimEnd())
  return `${baseMarkdown.trimEnd()}\n\n${lines.join("\n")}`
}
