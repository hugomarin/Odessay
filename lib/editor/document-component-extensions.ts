import { Extension, Node, mergeAttributes, type CommandProps, type NodeViewRendererProps } from "@tiptap/core"
import CodeBlock from "@tiptap/extension-code-block"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { findWrapping } from "@tiptap/pm/transform"
import { escapeControlledAttribute } from "@/lib/document-components/entities"
import { parseControlledComponentPrefix } from "@/lib/document-components/parser"
import { DocumentComponentSpecRegistry } from "@/lib/document-components/registry"
import type { DocumentComponentKind } from "@/lib/document-components/types"

type ControlledBlockKind = "Tip" | "Info" | "Card"
type ControlledBlockNodeName = "tip" | "info" | "card"

export type CardAttributes = {
  title: string
  icon?: string
  href?: string
}

export const CONTROLLED_BLOCK_NODE_NAMES: Readonly<Record<ControlledBlockKind, ControlledBlockNodeName>> = {
  Tip: "tip",
  Info: "info",
  Card: "card",
}

const nodeNameForKind = (kind: ControlledBlockKind) => CONTROLLED_BLOCK_NODE_NAMES[kind]

const kindForNodeName = (name: string): ControlledBlockKind | null => {
  const match = Object.entries(CONTROLLED_BLOCK_NODE_NAMES).find(([, nodeName]) => nodeName === name)
  return (match?.[0] as ControlledBlockKind | undefined) ?? null
}

const isValidAttribute = (kind: ControlledBlockKind, name: string, value: string) => {
  const attribute = DocumentComponentSpecRegistry.get(kind)?.attributes.find((candidate) => candidate.name === name)
  if (!attribute) return false
  if (!value) return !attribute.required
  return attribute.validate?.(value) ?? true
}

const canInsertAtSelection = (state: CommandProps["state"], kind: ControlledBlockKind) => {
  const spec = DocumentComponentSpecRegistry.get(kind)
  if (!spec) return false

  for (let depth = state.selection.$from.depth; depth >= 0; depth -= 1) {
    const node = state.selection.$from.node(depth)
    if (node.isTextblock) continue
    if (node.type.name === "doc") return spec.allowedParents.includes("document")
    const parentKind = kindForNodeName(node.type.name)
    if (parentKind) return spec.allowedParents.includes(parentKind)
    return false
  }
  return false
}

const decodeDataAttribute = (value: string | null) => {
  if (!value) return ""
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const canonicalAttributes = (kind: ControlledBlockKind, attributes: Record<string, unknown>) => {
  const spec = DocumentComponentSpecRegistry.get(kind)
  if (!spec) throw new Error(`Missing component spec for ${kind}.`)
  return spec.attributes
    .filter(({ name }) => String(attributes[name] ?? "").length > 0)
    .map(({ name }) => `${name}="${escapeControlledAttribute(String(attributes[name]))}"`)
    .join(" ")
}

type MarkdownBlockToken = {
  content: string
  map: [number, number] | null
  block: boolean
}

type MarkdownBlockState = {
  src: string
  bMarks: number[]
  eMarks: number[]
  line: number
  push: (type: string, tag: string, nesting: number) => MarkdownBlockToken
}

const removeBoundaryNewlines = (value: string) => value.replace(/^\n/, "").replace(/\n$/, "")

// The shared IR owns recognition and validation. This adapter only projects a
// validated top-level block into HTML for tiptap-markdown's DOM parser.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setupMarkdownItRule = (kind: ControlledBlockKind) => (md: any) => {
  md.block.ruler.before(
    "html_block",
    `odessay_${kind.toLowerCase()}`,
    (state: MarkdownBlockState, startLine: number, _endLine: number, silent: boolean) => {
      const start = state.bMarks[startLine]
      const openingLine = state.src.slice(start, state.eMarks[startLine])
      if (!new RegExp(`^<${kind}(?:\\s|>)`).test(openingLine)) return false
      const remaining = state.src.slice(start)
      const first = parseControlledComponentPrefix(remaining)
      if (!first || first.kind !== kind) return false
      const fragment = remaining.slice(0, first.end)
      if (silent) return true

      const raw = fragment
      const openingEnd = raw.indexOf(">") + 1
      const closingStart = raw.lastIndexOf(`</${kind}>`)
      if (openingEnd === 0 || closingStart < openingEnd) return false

      const dataAttributes = Object.entries(first.attributes)
        .map(([name, value]) => ` data-${name}="${encodeURIComponent(value)}"`)
        .join("")
      const body = removeBoundaryNewlines(raw.slice(openingEnd, closingStart))
      const token = state.push("html_block", "", 0)
      token.content = `<odessay-${kind.toLowerCase()}${dataAttributes}>${md.render(body)}</odessay-${kind.toLowerCase()}>\n`
      token.map = [startLine, startLine + raw.split("\n").length]
      token.block = true

      const nextOffset = start + fragment.length
      let nextLine = startLine + 1
      while (nextLine < state.bMarks.length && state.bMarks[nextLine] < nextOffset) nextLine += 1
      state.line = nextLine
      return true
    },
  )
}

const updateNodeAttributes = (
  props: Pick<NodeViewRendererProps, "editor" | "getPos">,
  attributes: Record<string, string>,
) => {
  const position = props.getPos()
  if (typeof position !== "number") return
  const liveNode = props.editor.state.doc.nodeAt(position)
  if (!liveNode) return
  props.editor.view.dispatch(
    props.editor.state.tr.setNodeMarkup(position, undefined, { ...liveNode.attrs, ...attributes }),
  )
}

const createControlledBlockNodeView = (kind: ControlledBlockKind) =>
  (props: NodeViewRendererProps) => {
    let currentNode = props.node
    const dom = document.createElement("section")
    dom.className = `odessay-component-block odessay-component-${kind.toLowerCase()}`
    dom.dataset.component = kind

    const header = document.createElement("header")
    header.className = "odessay-component-header"
    header.contentEditable = "false"

    const label = document.createElement("span")
    label.className = "odessay-component-label"
    label.textContent = kind
    header.append(label)

    const title = document.createElement("input")
    title.className = "odessay-component-title"
    title.setAttribute("aria-label", `${kind} title`)
    title.placeholder = kind === "Card" ? "Card title" : "Optional title"
    title.value = String(currentNode.attrs.title ?? "")
    title.addEventListener("input", () => {
      const nextTitle = title.value
      if (kind === "Card" && !nextTitle.trim()) return
      updateNodeAttributes(props, { title: nextTitle })
    })
    title.addEventListener("change", () => {
      const nextTitle = title.value.trim()
      if (kind === "Card" && !nextTitle) {
        title.value = String(currentNode.attrs.title ?? "Card")
        return
      }
      updateNodeAttributes(props, { title: nextTitle })
    })
    title.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      props.editor.commands.focus()
    })
    header.append(title)

    let details: HTMLDivElement | null = null
    if (kind === "Card") {
      const settings = document.createElement("button")
      settings.type = "button"
      settings.className = "odessay-component-settings"
      settings.setAttribute("aria-label", "Edit card properties")
      settings.setAttribute("aria-expanded", "false")
      settings.textContent = "•••"
      header.append(settings)

      details = document.createElement("div")
      details.className = "odessay-card-properties"
      details.hidden = true
      details.contentEditable = "false"

      const icon = document.createElement("input")
      icon.setAttribute("aria-label", "Card icon")
      icon.placeholder = "Icon (optional)"
      icon.value = String(currentNode.attrs.icon ?? "")
      const href = document.createElement("input")
      href.setAttribute("aria-label", "Card link")
      href.placeholder = "Link (optional)"
      href.value = String(currentNode.attrs.href ?? "")
      details.append(icon, href)

      const closeDetails = () => {
        if (!details) return
        details.hidden = true
        settings.setAttribute("aria-expanded", "false")
        settings.focus()
      }
      settings.addEventListener("click", () => {
        if (!details) return
        details.hidden = !details.hidden
        settings.setAttribute("aria-expanded", String(!details.hidden))
        if (!details.hidden) icon.focus()
      })
      for (const input of [icon, href]) {
        input.addEventListener("change", () => {
          const nextHref = href.value.trim()
          const hrefIsValid = isValidAttribute("Card", "href", nextHref)
          href.setAttribute("aria-invalid", String(!hrefIsValid))
          if (!hrefIsValid) return
          updateNodeAttributes(props, { icon: icon.value.trim(), href: href.value.trim() })
        })
        input.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            closeDetails()
          }
        })
      }
    }

    const contentDOM = document.createElement("div")
    contentDOM.className = "odessay-component-content"
    dom.append(header)
    if (details) dom.append(details)
    dom.append(contentDOM)

    return {
      dom,
      contentDOM,
      update(node: ProseMirrorNode) {
        if (node.type !== currentNode.type) return false
        currentNode = node
        title.value = String(node.attrs.title ?? "")
        if (details) {
          const inputs = details.querySelectorAll("input")
          if (inputs[0]) inputs[0].value = String(node.attrs.icon ?? "")
          if (inputs[1]) inputs[1].value = String(node.attrs.href ?? "")
        }
        return true
      },
      stopEvent(event: Event) {
        return event.target instanceof HTMLElement && Boolean(event.target.closest("input, button, .odessay-card-properties"))
      },
    }
  }

const createControlledBlockNode = (kind: ControlledBlockKind) => {
  const spec = DocumentComponentSpecRegistry.get(kind)
  if (!spec) throw new Error(`Missing component spec for ${kind}.`)

  return Node.create({
    name: nodeNameForKind(kind),
    group: "controlledBlock",
    content: "block+",
    defining: true,
    isolating: true,

    addAttributes() {
      return Object.fromEntries(
        spec.attributes.map(({ name, required }) => [
          name,
          {
            default: required ? kind : "",
            parseHTML: (element: HTMLElement) => decodeDataAttribute(element.getAttribute(`data-${name}`)),
            renderHTML: (attributes: Record<string, unknown>) =>
              String(attributes[name] ?? "").length > 0
                ? { [`data-${name}`]: encodeURIComponent(String(attributes[name])) }
                : {},
          },
        ]),
      )
    },

    parseHTML() {
      return [{ tag: `odessay-${kind.toLowerCase()}` }]
    },

    renderHTML({ HTMLAttributes }) {
      return [
        `odessay-${kind.toLowerCase()}`,
        mergeAttributes(HTMLAttributes, { "data-component": kind }),
        0,
      ]
    },

    addNodeView() {
      return createControlledBlockNodeView(kind)
    },

    addStorage() {
      return {
        markdown: {
          parse: { setup: setupMarkdownItRule(kind) },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          serialize(state: any, node: any) {
            const attributes = canonicalAttributes(kind, node.attrs)
            state.write(`<${kind}${attributes ? ` ${attributes}` : ""}>\n`)
            state.renderContent(node)
            state.flushClose(1)
            state.write(`</${kind}>`)
            state.closeBlock(node)
          },
        },
      }
    },
  })
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    documentComponents: {
      insertTip: (attributes?: { title?: string }) => ReturnType
      insertInfo: (attributes?: { title?: string }) => ReturnType
      insertCard: (attributes?: Partial<CardAttributes>) => ReturnType
      convertSelectionToCard: (attributes?: Partial<CardAttributes>) => ReturnType
      updateCardAttributes: (attributes: Partial<CardAttributes>) => ReturnType
      setCodeBlockLanguage: (language: string) => ReturnType
    }
  }
}

export const DocumentComponentCommands = Extension.create({
  name: "documentComponentCommands",

  addCommands() {
    const insert = (kind: ControlledBlockKind, attributes: Record<string, string> = {}) =>
      ({ commands, state }: CommandProps) => {
        if (!canInsertAtSelection(state, kind)) return false
        if (Object.entries(attributes).some(([name, value]) => !isValidAttribute(kind, name, value))) return false
        return commands.insertContent({
          type: nodeNameForKind(kind),
          attrs: kind === "Card" ? { title: "Card", ...attributes } : attributes,
          content: [{ type: "paragraph" }],
        })
      }

    return {
      insertTip: (attributes = {}) => insert("Tip", { title: attributes.title ?? "" }),
      insertInfo: (attributes = {}) => insert("Info", { title: attributes.title ?? "" }),
      insertCard: (attributes = {}) =>
        insert("Card", {
          title: attributes.title?.trim() || "Card",
          icon: attributes.icon?.trim() ?? "",
          href: attributes.href?.trim() ?? "",
        }),
      convertSelectionToCard:
        (attributes = {}) =>
        ({ state, dispatch }) => {
          const cardType = state.schema.nodes[nodeNameForKind("Card")]
          if (!cardType) return false
          if (state.selection.empty || !canInsertAtSelection(state, "Card")) return false
          const nextAttributes = {
            title: attributes.title?.trim() || "Card",
            icon: attributes.icon?.trim() ?? "",
            href: attributes.href?.trim() ?? "",
          }
          if (Object.entries(nextAttributes).some(([name, value]) => !isValidAttribute("Card", name, value))) return false
          const range = state.selection.$from.blockRange(state.selection.$to)
          if (!range || range.parent.type.name !== "doc") return false
          const wrapping = findWrapping(range, cardType, nextAttributes)
          if (!wrapping) return false
          if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView())
          return true
        },
      updateCardAttributes:
        (attributes) =>
        ({ commands }) => {
          const entries = Object.entries(attributes).map(([name, value]) => [name, value?.trim() ?? ""] as const)
          if (entries.some(([name, value]) => !isValidAttribute("Card", name, value))) return false
          return commands.updateAttributes(nodeNameForKind("Card"), Object.fromEntries(entries))
        },
      setCodeBlockLanguage:
        (language) =>
        ({ commands }) =>
          commands.updateAttributes("codeBlock", { language }),
    }
  },
})

export const TipBlock = createControlledBlockNode("Tip")
export const InfoBlock = createControlledBlockNode("Info")
export const CardBlock = createControlledBlockNode("Card")

const COMMON_CODE_LANGUAGES = ["", "bash", "css", "html", "javascript", "json", "markdown", "python", "sql", "typescript"]

export const DocumentCodeBlock = CodeBlock.extend({
  addKeyboardShortcuts: () => ({}),

  addNodeView() {
    return ({ node, editor, getPos }: NodeViewRendererProps) => {
      let currentNode = node
      const dom = document.createElement("section")
      dom.className = "odessay-code-block"
      const toolbar = document.createElement("div")
      toolbar.className = "odessay-code-toolbar"
      toolbar.contentEditable = "false"
      const label = document.createElement("label")
      label.textContent = "Language"
      const input = document.createElement("input")
      input.setAttribute("aria-label", "Code language")
      input.setAttribute("list", "odessay-code-languages")
      input.value = String(node.attrs.language ?? "")
      const datalist = document.createElement("datalist")
      datalist.id = "odessay-code-languages"
      for (const language of COMMON_CODE_LANGUAGES) {
        const option = document.createElement("option")
        option.value = language
        datalist.append(option)
      }
      label.append(input, datalist)
      toolbar.append(label)
      const pre = document.createElement("pre")
      const contentDOM = document.createElement("code")
      pre.append(contentDOM)
      dom.append(toolbar, pre)

      const updateLanguage = () => {
        const position = getPos()
        if (typeof position !== "number") return
        const liveNode = editor.state.doc.nodeAt(position)
        if (!liveNode || liveNode.type.name !== "codeBlock") return
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(position, undefined, { ...liveNode.attrs, language: input.value.trim() }),
        )
      }
      input.addEventListener("change", updateLanguage)
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        editor.commands.focus()
      })

      return {
        dom,
        contentDOM,
        update(nextNode) {
          if (nextNode.type !== currentNode.type) return false
          currentNode = nextNode
          input.value = String(nextNode.attrs.language ?? "")
          return true
        },
        stopEvent(event) {
          return event.target === input || event.target === datalist
        },
      }
    }
  },
})

export const isFirstBlockSliceKind = (kind: DocumentComponentKind) =>
  kind === "Tip" || kind === "Info" || kind === "Card" || kind === "CodeBlock"
