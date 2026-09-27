import { Extension, Node, mergeAttributes, type CommandProps, type NodeViewRendererProps } from "@tiptap/core"
import CodeBlock from "@tiptap/extension-code-block"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { findWrapping } from "@tiptap/pm/transform"
import type { ViewMutationRecord } from "@tiptap/pm/view"
import { escapeControlledAttribute } from "@/lib/document-components/entities"
import { parseControlledComponentAt } from "@/lib/document-components/parser"
import { DocumentComponentSpecRegistry } from "@/lib/document-components/registry"
import type { DocumentComponentKind } from "@/lib/document-components/types"
import { isMermaidLanguage } from "@/lib/mermaid/mermaid-language"

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
      const first = parseControlledComponentAt(state.src, start)
      if (!first || first.kind !== kind) return false
      const fragment = state.src.slice(start, first.end)
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
      ignoreMutation(mutation: ViewMutationRecord) {
        return !contentDOM.contains(mutation.target)
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

const COMMON_CODE_LANGUAGES = ["", "bash", "css", "html", "javascript", "json", "markdown", "mermaid", "python", "sql", "typescript"]

let mermaidPreviewCounter = 0

export const DocumentCodeBlock = CodeBlock.extend({
  addKeyboardShortcuts: () => ({}),

  addNodeView() {
    return ({ node, editor, getPos }: NodeViewRendererProps) => {
      let currentNode = node
      let disposed = false
      let previewVisible = false
      let previewZoom = 1
      let lastRenderedSource: string | null = null
      let renderSequence = 0
      let unobservePreview: (() => void) | null = null
      mermaidPreviewCounter += 1
      const previewId = `odessay-mermaid-preview-${mermaidPreviewCounter}`
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

      // ODE-533: Mermaid chrome lives outside contentDOM as UI-only state.
      // Source stays canonical in the ProseMirror codeBlock; preview, zoom and
      // visibility never serialize. Mermaid loads lazily via the shared
      // coordinator (no static import, one observer owner).
      const mermaidBar = document.createElement("div")
      mermaidBar.className = "odessay-mermaid-bar"
      mermaidBar.contentEditable = "false"
      mermaidBar.hidden = true
      const toggle = document.createElement("button")
      toggle.type = "button"
      toggle.className = "odessay-mermaid-toggle"
      toggle.setAttribute("aria-controls", previewId)
      toggle.setAttribute("aria-expanded", "false")
      toggle.textContent = "Preview diagram"
      const zoomOut = document.createElement("button")
      zoomOut.type = "button"
      zoomOut.className = "odessay-mermaid-zoom"
      zoomOut.setAttribute("aria-label", "Zoom out diagram preview")
      zoomOut.textContent = "−"
      zoomOut.hidden = true
      const zoomLabel = document.createElement("span")
      zoomLabel.className = "odessay-mermaid-zoom-label"
      zoomLabel.setAttribute("aria-live", "polite")
      zoomLabel.hidden = true
      const zoomIn = document.createElement("button")
      zoomIn.type = "button"
      zoomIn.className = "odessay-mermaid-zoom"
      zoomIn.setAttribute("aria-label", "Zoom in diagram preview")
      zoomIn.textContent = "+"
      zoomIn.hidden = true
      mermaidBar.append(toggle, zoomOut, zoomLabel, zoomIn)

      const preview = document.createElement("div")
      preview.id = previewId
      preview.className = "odessay-mermaid-preview"
      preview.setAttribute("role", "region")
      preview.setAttribute("aria-label", "Diagram preview")
      preview.contentEditable = "false"
      preview.hidden = true
      const status = document.createElement("p")
      status.className = "odessay-mermaid-status"
      status.setAttribute("aria-live", "polite")
      status.hidden = true
      const canvas = document.createElement("div")
      canvas.className = "odessay-mermaid-canvas"
      const errorBox = document.createElement("div")
      errorBox.className = "odessay-mermaid-error"
      errorBox.setAttribute("role", "alert")
      errorBox.hidden = true
      const errorText = document.createElement("p")
      errorText.className = "odessay-mermaid-error-text"
      const retry = document.createElement("button")
      retry.type = "button"
      retry.className = "odessay-mermaid-retry"
      retry.textContent = "Retry preview"
      errorBox.append(errorText, retry)
      preview.append(status, canvas, errorBox)
      dom.append(mermaidBar, preview)

      const readLiveSource = (): string | null => {
        const position = typeof getPos === "function" ? getPos() : null
        if (typeof position !== "number") return currentNode.textContent ?? null
        const liveNode = editor.state.doc.nodeAt(position)
        if (!liveNode || liveNode.type.name !== "codeBlock") return null
        return liveNode.textContent ?? ""
      }

      const readLiveLanguage = (): string => {
        const position = typeof getPos === "function" ? getPos() : null
        if (typeof position !== "number") return String(currentNode.attrs.language ?? "")
        const liveNode = editor.state.doc.nodeAt(position)
        if (!liveNode || liveNode.type.name !== "codeBlock") return String(currentNode.attrs.language ?? "")
        return String(liveNode.attrs.language ?? "")
      }

      const refreshMermaidChrome = () => {
        // mermaid-language has no renderer dependency, so this static import
        // adds no bootstrap cost. The heavy renderer stays behind the dynamic
        // coordinator import in requestPreviewRender/scheduleRenderWhenVisible.
        const isMermaid = isMermaidLanguage(readLiveLanguage())
        mermaidBar.hidden = !isMermaid
        dom.classList.toggle("odessay-code-mermaid", isMermaid)
        if (!isMermaid && previewVisible) {
          previewVisible = false
          preview.hidden = true
          toggle.setAttribute("aria-expanded", "false")
          toggle.textContent = "Preview diagram"
        }
        zoomOut.hidden = !isMermaid || !previewVisible
        zoomIn.hidden = !isMermaid || !previewVisible
        zoomLabel.hidden = !isMermaid || !previewVisible
      }

      const paintZoom = () => {
        zoomLabel.textContent = `${Math.round(previewZoom * 100)}%`
        canvas.style.width = `${Math.round(previewZoom * 100)}%`
      }

      const showStatus = (message: string) => {
        status.textContent = message
        status.hidden = false
        errorBox.hidden = true
        canvas.replaceChildren()
      }

      const showError = (message: string) => {
        status.hidden = true
        errorText.textContent = message
        errorBox.hidden = false
      }

      const commitSvg = (svg: string, sequence: number, requestedSource: string) => {
        if (disposed || sequence !== renderSequence || !previewVisible) return
        if (readLiveSource() !== requestedSource) return
        status.hidden = true
        errorBox.hidden = true
        canvas.replaceChildren()
        const wrapper = document.createElement("div")
        wrapper.className = "odessay-mermaid-svg"
        // The SVG was sanitized by the loader; injecting it as markup is the
        // documented Mermaid integration path. Source remains the authority.
        wrapper.innerHTML = svg
        canvas.append(wrapper)
        paintZoom()
        lastRenderedSource = requestedSource
      }

      const requestPreviewRender = () => {
        const source = readLiveSource() ?? ""
        if (!source.trim()) {
          showError("Diagram source is empty. Write a diagram to preview it.")
          return
        }
        if (source === lastRenderedSource && canvas.firstChild) return
        renderSequence += 1
        const sequence = renderSequence
        showStatus("Rendering diagram…")
        // Lazy-load the coordinator + renderer only on explicit request.
        void import("@/lib/mermaid/mermaid-coordinator").then(({ mermaidRenderCoordinator }) => {
          if (disposed || sequence !== renderSequence || !previewVisible) return
          const revision = mermaidRenderCoordinator.nextRevision()
          void mermaidRenderCoordinator
            .requestRender(source, revision)
            .then((svg) => commitSvg(svg, sequence, source))
            .catch((error: unknown) => {
              if (disposed || sequence !== renderSequence || !previewVisible) return
              if (readLiveSource() !== source) return
              const message =
                error instanceof Error && error.message ? error.message : "Diagram could not be rendered. The source is preserved."
              showError(message)
            })
        })
      }

      const scheduleRenderWhenVisible = () => {
        unobservePreview?.()
        unobservePreview = null
        if (typeof IntersectionObserver === "undefined") {
          requestPreviewRender()
          return
        }
        void import("@/lib/mermaid/mermaid-coordinator").then(({ mermaidRenderCoordinator }) => {
          if (disposed || !previewVisible) return
          const source = readLiveSource() ?? ""
          if (source === lastRenderedSource && canvas.firstChild) return
          unobservePreview = mermaidRenderCoordinator.observe(preview, () => {
            unobservePreview = null
            requestPreviewRender()
          })
        })
      }

      toggle.addEventListener("click", () => {
        previewVisible = !previewVisible
        preview.hidden = !previewVisible
        toggle.setAttribute("aria-expanded", String(previewVisible))
        toggle.textContent = previewVisible ? "Hide preview" : "Preview diagram"
        zoomOut.hidden = !previewVisible
        zoomIn.hidden = !previewVisible
        zoomLabel.hidden = !previewVisible
        if (previewVisible) {
          paintZoom()
          scheduleRenderWhenVisible()
          toggle.focus()
        } else {
          unobservePreview?.()
          unobservePreview = null
          renderSequence += 1
        }
      })
      const refocusEditor = () => {
        editor.commands.focus()
      }
      for (const control of [toggle, retry, zoomIn, zoomOut]) {
        control.addEventListener("keydown", (event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          refocusEditor()
        })
      }
      retry.addEventListener("click", () => {
        lastRenderedSource = null
        renderSequence += 1
        requestPreviewRender()
        retry.focus()
      })
      zoomIn.addEventListener("click", () => {
        previewZoom = Math.min(2, Math.round((previewZoom + 0.25) * 100) / 100)
        paintZoom()
        zoomIn.focus()
      })
      zoomOut.addEventListener("click", () => {
        previewZoom = Math.max(0.5, Math.round((previewZoom - 0.25) * 100) / 100)
        paintZoom()
        zoomOut.focus()
      })
      refreshMermaidChrome()
      paintZoom()

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
          refreshMermaidChrome()
          return true
        },
        stopEvent(event) {
          return (
            event.target === input ||
            event.target === datalist ||
            (event.target instanceof HTMLElement &&
              Boolean(event.target.closest(".odessay-mermaid-bar, .odessay-mermaid-preview")))
          )
        },
        ignoreMutation(mutation) {
          // ODE-540: preview/status chrome mutates outside contentDOM during
          // async renders. Those mutations must never be read as document
          // edits; only mutations inside the editable <code> matter.
          return !contentDOM.contains(mutation.target)
        },
        destroy() {
          disposed = true
          renderSequence += 1
          unobservePreview?.()
          unobservePreview = null
        },
      }
    }
  },
})

export const isFirstBlockSliceKind = (kind: DocumentComponentKind) =>
  kind === "Tip" || kind === "Info" || kind === "Card" || kind === "CodeBlock"
