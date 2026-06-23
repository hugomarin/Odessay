import type { Extensions, JSONContent } from "@tiptap/core"
import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import BulletList from "@tiptap/extension-bullet-list"
import Code from "@tiptap/extension-code"
import CodeBlock from "@tiptap/extension-code-block"
import Document from "@tiptap/extension-document"
import Heading from "@tiptap/extension-heading"
import Highlight from "@tiptap/extension-highlight"
import Image from "@tiptap/extension-image"
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
import { sanitizeWritingBodyJson, sanitizeWritingBodyText } from "@/lib/editor/content-sanitizer"
import { FootnoteExtension } from "@/lib/editor/footnote-extension"
import { AnnotationReferenceNode } from "@/lib/editor/footnote-node"
import { FrontmatterNode } from "@/lib/editor/frontmatter-node"

export const WRITING_BODY_EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  Strike,
  Highlight,
  Image.configure({ allowBase64: false, inline: false }),
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
  FrontmatterNode,
  AnnotationReferenceNode,
  FootnoteExtension,
] satisfies Extensions

export type RenderWritingBodyHtmlOptions = {
  renderRichHtml?: (bodyJson: JSONContent) => string
  onRichRenderError?: (errorMessage: string) => void
}

export const containWideTables = (html: string) =>
  html.replace(
    /<table\b[\s\S]*?<\/table>/g,
    (tableHtml) => `<div class="odessay-table-wrap prose-odessay-table-wrap">${tableHtml}</div>`,
  )

export const isRenderableBodyJson = (value: JSONContent | null | undefined): value is JSONContent =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

export const renderPlainTextHtml = (bodyText: string | null | undefined) => {
  const normalized = sanitizeWritingBodyText(bodyText)

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

export const sanitizeRenderInputs = (
  bodyJson: JSONContent | null | undefined,
  bodyText: string | null | undefined,
) => ({
  bodyJson: sanitizeWritingBodyJson(bodyJson),
  bodyText: sanitizeWritingBodyText(bodyText),
})
