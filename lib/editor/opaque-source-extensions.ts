import { Node } from "@tiptap/core"
import { parseControlledMarkdown } from "@/lib/document-components/parser"
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
): OpaqueSpan[] => {
  const parsed = parseControlledMarkdown(source, { recoverUnclosedUnknownTags: true })
  const spans: OpaqueSpan[] = []

  const visit = (nodes: DocumentIrNode[]) => {
    for (const node of nodes) {
      if (node.type === "opaque") {
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
  return spans
}

const replaceSpans = (source: string, spans: OpaqueSpan[], sourceStartsLine: boolean) => {
  if (spans.length === 0) return source

  // Core IR traversal emits disjoint opaque spans in source order. Compute the
  // same suffix context the former right-to-left replacements observed, then
  // assemble the result without copying the full source for every span.
  const replacements = new Array<string>(spans.length)
  const replacementPrefixes = new Array<string>(spans.length)
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index]
    const nextSpan = spans[index + 1]
    const gapEnd = nextSpan?.start ?? source.length
    let suffixPrefix = source.slice(span.end, Math.min(span.end + 2, gapEnd))
    if (suffixPrefix.length < 2 && nextSpan) {
      suffixPrefix += replacementPrefixes[index + 1].slice(0, 2 - suffixPrefix.length)
    }
    const suffixIsEmpty = !nextSpan && span.end === source.length
    const suffixIsOneNewline =
      !nextSpan && source.length - span.end === 1 && source[span.end] === "\n"
    const startsLine = span.start === 0 ? sourceStartsLine : source[span.start - 1] === "\n"
    const endsLine = suffixIsEmpty || suffixPrefix.startsWith("\n")
    const raw = source.slice(span.start, span.end)

    if (!raw.includes("\n") || !startsLine || !endsLine) {
      replacements[index] = `<odessay-opaque${placeholderAttributes(raw, span)}></odessay-opaque>`
      replacementPrefixes[index] = replacements[index].slice(0, 2)
      continue
    }

    // A multi-line span on its own lines is a block. markdown-it only opens an
    // HTML block for a lone tag line that does not interrupt a paragraph, so
    // the placeholder is separated by blank lines (surrounding canonicalization
    // only; the opaque bytes themselves are untouched).
    const beforeEmpty = span.start === 0
    const beforeEndsWithDoubleNewline =
      span.start >= 2 && source[span.start - 2] === "\n" && source[span.start - 1] === "\n"
    const leading = beforeEmpty || beforeEndsWithDoubleNewline
      ? ""
      : source[span.start - 1] === "\n"
        ? "\n"
        : "\n\n"
    const trailing =
      suffixIsEmpty || suffixIsOneNewline || suffixPrefix.startsWith("\n\n") ? "" : "\n"
    replacements[index] = `${leading}<odessay-opaque-block${placeholderAttributes(raw, span)}>\n</odessay-opaque-block>${trailing}`
    replacementPrefixes[index] = replacements[index].slice(0, 2)
  }

  const output: string[] = []
  let cursor = 0
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]
    output.push(source.slice(cursor, span.start), replacements[index])
    cursor = span.end
  }
  output.push(source.slice(cursor))
  return output.join("")
}

/**
 * Projects every span Rich cannot author into placeholders that the opaque
 * nodes below parse. Recognition stays in the core parser; this adapter only
 * decides between an inline token and a block.
 */
export const materializeOpaqueSourceForRichParser = (markdown: string): string => {
  if (!/<\/?[A-Z]/.test(markdown)) return markdown
  return replaceSpans(markdown, collectOpaqueSpans(markdown), true)
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
