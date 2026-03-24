import { Node, mergeAttributes } from "@tiptap/core"

export const FOOTNOTE_REF_EVENT = "footnote:click"

const FOOTNOTE_REF_RE = /\[\^(\d+)\]/g
const FOOTNOTE_DEFINITION_LINE_RE = /^\[\^\d+\]:\s*/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setupMarkdownItRule(md: any) {
  md.core.ruler.push("footnote_inline_ref", (state: { tokens: { type: string; children: { type: string; content: string }[] | null }[] }) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== "inline") continue
      const children = blockToken.children
      if (!children) continue

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

          nextChildren.push({
            type: "html_inline",
            content: `<footnote-ref index="${match[1]}"></footnote-ref>`,
          })

          lastIndex = match.index + match[0].length
        }

        if (lastIndex === 0) {
          nextChildren.push(child)
        } else if (lastIndex < text.length) {
          nextChildren.push({ type: "text", content: text.slice(lastIndex) })
        }
      }

      blockToken.children = nextChildren
    }
  })
}

function stripDefinitionNodesFromDOM(element: Element) {
  element.querySelectorAll("p").forEach((p) => {
    if (FOOTNOTE_DEFINITION_LINE_RE.test(p.textContent?.trim() ?? "")) {
      p.remove()
    }
  })
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
          return Number.isNaN(parsed) ? false : { index: parsed }
        },
      },
      {
        tag: "footnote-ref",
        getAttrs: (node) => {
          const el = node as HTMLElement
          const raw = el.getAttribute("index")
          const parsed = Number(raw)
          return Number.isNaN(parsed) ? false : { index: parsed }
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
          updateDOM: stripDefinitionNodesFromDOM,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write(`[^${node.attrs.index}]`)
        },
      },
    }
  },
})
