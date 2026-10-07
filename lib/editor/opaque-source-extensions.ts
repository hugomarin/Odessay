import { Node } from "@tiptap/core"
import { parseControlledMarkdown, readControlledTagEnd } from "@/lib/document-components/parser"
import { projectIrNodePlainText } from "@/lib/document-components/plain-text"
import type { DocumentIrNode } from "@/lib/document-components/types"

/**
 * Kinds the Rich surface can author with a dedicated TipTap adapter. Every
 * other component — and every span the core parser left opaque — reaches Rich
 * as preserved source (surface-projections.md, "Opaque source" row): the exact
 * bytes survive Rich → Markdown, nothing executes, and nothing is cleaned up.
 * A kind joins this set only together with its adapter (ODE-534/535/539).
 */
const RICH_ADAPTED_KINDS: ReadonlySet<string> = new Set([
  "Annotation",
  "Entity",
  "Highlight",
  "Tip",
  "Info",
  "Card",
])

export const OPAQUE_SOURCE_INLINE_NODE = "opaqueSource"
export const OPAQUE_SOURCE_BLOCK_NODE = "opaqueSourceBlock"
const RICH_ADAPTER_UNAVAILABLE = "rich-adapter-unavailable"

type OpaqueSpan = {
  start: number
  end: number
  text: string
  reason: string
}

const encode = (value: string) => encodeURIComponent(value)

const decode = (value: string | null) => {
  if (!value) return ""
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const placeholderAttributes = (raw: string, span: OpaqueSpan) =>
  ` data-raw="${encode(raw)}" data-text="${encode(span.text)}" data-reason="${encode(span.reason)}"`

const collectOpaqueSpans = (
  source: string,
): { spans: OpaqueSpan[]; resumeAt: number | null } => {
  const parsed = parseControlledMarkdown(source)
  const spans: OpaqueSpan[] = []
  let resumeAt: number | null = null

  const visit = (nodes: DocumentIrNode[]) => {
    for (const node of nodes) {
      if (resumeAt !== null) return
      if (node.type === "opaque") {
        const diagnostic = parsed.diagnostics.find((candidate) => candidate.start === node.start)
        const closing = diagnostic?.kind ? `</${diagnostic.kind}>` : null
        // An unknown PascalCase tag that never closes is almost always prose
        // ("List<String>"). Its tag token is preserved literally and the rest
        // of the document stays editable Markdown; a *known* kind left open
        // remains one opaque span, exactly as the core parser decided.
        if (
          diagnostic?.code === "unknown-component" &&
          node.end === source.length &&
          closing &&
          !node.raw.endsWith(closing)
        ) {
          const tagEnd = readControlledTagEnd(source, node.start)
          if (tagEnd !== null) {
            const raw = source.slice(node.start, tagEnd)
            spans.push({ start: node.start, end: tagEnd, text: raw, reason: diagnostic.code })
            resumeAt = tagEnd
            return
          }
        }
        spans.push({ start: node.start, end: node.end, text: node.raw, reason: node.reason })
        continue
      }
      if (node.type !== "component") continue
      if (RICH_ADAPTED_KINDS.has(node.kind)) {
        visit(node.children)
        continue
      }
      spans.push({
        start: node.start,
        end: node.end,
        text: projectIrNodePlainText(node),
        reason: RICH_ADAPTER_UNAVAILABLE,
      })
    }
  }

  visit(parsed.document.children)
  return { spans, resumeAt }
}

const replaceSpans = (source: string, spans: OpaqueSpan[], sourceStartsLine: boolean) =>
  [...spans].sort((a, b) => b.start - a.start).reduce((result, span) => {
    const raw = source.slice(span.start, span.end)
    const before = result.slice(0, span.start)
    const after = result.slice(span.end)
    const startsLine = span.start === 0 ? sourceStartsLine : before.endsWith("\n")
    const endsLine = after === "" || after.startsWith("\n")
    if (!raw.includes("\n") || !startsLine || !endsLine) {
      return `${before}<odessay-opaque${placeholderAttributes(raw, span)}></odessay-opaque>${after}`
    }
    // A multi-line span on its own lines is a block. markdown-it only opens an
    // HTML block for a lone tag line that does not interrupt a paragraph, so
    // the placeholder is separated by blank lines (surrounding canonicalization
    // only; the opaque bytes themselves are untouched).
    const leading = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
    const trailing = after === "" || after.startsWith("\n\n") || after === "\n" ? "" : "\n"
    return `${before}${leading}<odessay-opaque-block${placeholderAttributes(raw, span)}>\n</odessay-opaque-block>${trailing}${after}`
  }, source)

/**
 * Projects every span Rich cannot author into placeholders that the opaque
 * nodes below parse. Recognition stays in the core parser; this adapter only
 * decides between an inline token and a block.
 */
export const materializeOpaqueSourceForRichParser = (markdown: string): string => {
  if (!/<\/?[A-Z]/.test(markdown)) return markdown

  let output = ""
  let rest = markdown
  let restStartsLine = true
  for (;;) {
    const { spans, resumeAt } = collectOpaqueSpans(rest)
    if (resumeAt === null) return output + replaceSpans(rest, spans, restStartsLine)
    output += replaceSpans(rest.slice(0, resumeAt), spans, restStartsLine)
    restStartsLine = rest[resumeAt - 1] === "\n"
    rest = rest.slice(resumeAt)
  }
}

const opaqueAttributes = () => ({
  raw: {
    default: "",
    parseHTML: (element: HTMLElement) => decode(element.getAttribute("data-raw")),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.raw ? { "data-raw": encode(String(attributes.raw)) } : {},
  },
  text: {
    default: "",
    parseHTML: (element: HTMLElement) => decode(element.getAttribute("data-text")),
    renderHTML: (attributes: Record<string, unknown>) => ({ "data-text": encode(String(attributes.text ?? "")) }),
  },
  reason: {
    default: "",
    parseHTML: (element: HTMLElement) => decode(element.getAttribute("data-reason")),
    renderHTML: (attributes: Record<string, unknown>) => ({ "data-reason": encode(String(attributes.reason ?? "")) }),
  },
})

const OPAQUE_TITLE = "Preserved source. Edit it in Markdown source mode."

// Reading surfaces receive these nodes after content-sanitizer has dropped
// `raw`; they render the conservative visible text, escaped by the DOM spec.
export const OpaqueSourceInline = Node.create({
  name: OPAQUE_SOURCE_INLINE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes: opaqueAttributes,

  parseHTML() {
    return [{ tag: "odessay-opaque" }, { tag: "span[data-opaque-source]" }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      { ...HTMLAttributes, class: "odessay-opaque-source", "data-opaque-source": "", title: OPAQUE_TITLE },
      String(node.attrs.text ?? ""),
    ]
  },

  renderText({ node }) {
    return String(node.attrs.text ?? "")
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write(String(node.attrs.raw || node.attrs.text || ""))
        },
      },
    }
  },
})

export const OpaqueSourceBlock = Node.create({
  name: OPAQUE_SOURCE_BLOCK_NODE,
  group: "block",
  atom: true,
  selectable: true,

  addAttributes: opaqueAttributes,

  parseHTML() {
    return [{ tag: "odessay-opaque-block" }, { tag: "div[data-opaque-source]" }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      { ...HTMLAttributes, class: "odessay-opaque-source-block", "data-opaque-source": "", title: OPAQUE_TITLE },
      String(node.attrs.text ?? ""),
    ]
  },

  renderText({ node }) {
    return String(node.attrs.text ?? "")
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write(String(node.attrs.raw || node.attrs.text || ""))
          state.closeBlock(node)
        },
      },
    }
  },
})
