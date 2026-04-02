import type { Extensions, JSONContent } from "@tiptap/core"
import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import BulletList from "@tiptap/extension-bullet-list"
import Code from "@tiptap/extension-code"
import CodeBlock from "@tiptap/extension-code-block"
import Document from "@tiptap/extension-document"
import Heading from "@tiptap/extension-heading"
import Highlight from "@tiptap/extension-highlight"
import Italic from "@tiptap/extension-italic"
import Link from "@tiptap/extension-link"
import ListItem from "@tiptap/extension-list-item"
import OrderedList from "@tiptap/extension-ordered-list"
import Paragraph from "@tiptap/extension-paragraph"
import Strike from "@tiptap/extension-strike"
import { Table } from "@tiptap/extension-table"
import { TableCell } from "@tiptap/extension-table-cell"
import { TableHeader } from "@tiptap/extension-table-header"
import { TableRow } from "@tiptap/extension-table-row"
import Text from "@tiptap/extension-text"
import { generateHTML } from "@tiptap/html"
import { FootnoteExtension } from "@/lib/editor/footnote-extension"

export const WRITING_BODY_EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  Strike,
  Highlight,
  Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }),
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  Code,
  CodeBlock,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  FootnoteExtension,
] satisfies Extensions

type RenderWritingBodyHtmlOptions = {
  renderRichHtml?: (bodyJson: JSONContent) => string
  onRichRenderError?: (errorMessage: string) => void
}

const isRenderableBodyJson = (value: JSONContent | null | undefined): value is JSONContent =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const renderPlainTextHtml = (bodyText: string | null | undefined) => {
  const normalized = (bodyText ?? "").replaceAll("\r\n", "\n").trim()

  if (!normalized) {
    return "<p></p>"
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`)

  return paragraphs.length > 0 ? paragraphs.join("") : "<p></p>"
}

export const renderWritingBodyHtml = (
  bodyJson: JSONContent | null | undefined,
  bodyText: string | null | undefined,
  options: RenderWritingBodyHtmlOptions = {},
): { bodyHtml: string; mode: "rich" | "plain-text" } => {
  if (isRenderableBodyJson(bodyJson)) {
    try {
      const renderRichHtml = options.renderRichHtml ?? ((value: JSONContent) => generateHTML(value, WRITING_BODY_EXTENSIONS))

      return {
        bodyHtml: renderRichHtml(bodyJson),
        mode: "rich",
      }
    } catch (error) {
      options.onRichRenderError?.(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    bodyHtml: renderPlainTextHtml(bodyText),
    mode: "plain-text",
  }
}
