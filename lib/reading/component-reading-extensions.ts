import type { Extensions } from "@tiptap/core"
import { validateComponentAttribute } from "@/lib/document-components/registry"
import { CardBlock, InfoBlock, TipBlock } from "@/lib/editor/document-component-extensions"

/**
 * Reading projection of the writer-enabled registered blocks
 * (surface-projections.md: shared accessible callout / shared card with a
 * safe link). The schema, attributes and parse rules are the editor's own
 * nodes; only the DOM output differs, so every reading surface that renders
 * through WRITING_BODY_EXTENSIONS gets the same projection and no authoring
 * chrome (inputs, menus) or attribute dumps.
 */
const titleOf = (attrs: Record<string, unknown>) => String(attrs.title ?? "").trim()

const ReadingCallout = (kind: "Tip" | "Info", node: typeof TipBlock) =>
  node.extend({
    addNodeView: undefined,
    renderHTML({ node: current }) {
      const title = titleOf(current.attrs)
      const titleSpec = title ? [["p", { class: "odessay-reading-component-title" }, title]] : []
      return [
        "aside",
        {
          class: `odessay-reading-component odessay-reading-${kind.toLowerCase()}`,
          "data-component": kind,
          "aria-label": title || kind,
        },
        ...titleSpec,
        ["div", { class: "odessay-reading-component-body" }, 0],
      ]
    },
  })

export const ReadingCardBlock = CardBlock.extend({
  addNodeView: undefined,
  renderHTML({ node }) {
    const title = titleOf(node.attrs)
    const href = String(node.attrs.href ?? "")
    const safeHref = href && validateComponentAttribute("Card", "href", href) ? href : null
    return [
      "section",
      {
        class: "odessay-reading-component odessay-reading-card",
        "data-component": "Card",
        "aria-label": title || "Card",
      },
      ["p", { class: "odessay-reading-component-title" }, safeHref ? ["a", { href: safeHref }, title] : title],
      ["div", { class: "odessay-reading-component-body" }, 0],
    ]
  },
})

export const READING_COMPONENT_BLOCK_EXTENSIONS = [
  ReadingCallout("Tip", TipBlock),
  ReadingCallout("Info", InfoBlock),
  ReadingCardBlock,
] satisfies Extensions
