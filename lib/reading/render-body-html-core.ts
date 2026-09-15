import type { Extensions, JSONContent } from "@tiptap/core"
import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import BulletList from "@tiptap/extension-bullet-list"
import Code from "@tiptap/extension-code"
import CodeBlock from "@tiptap/extension-code-block"
import Document from "@tiptap/extension-document"
import Heading from "@tiptap/extension-heading"
import HorizontalRule from "@tiptap/extension-horizontal-rule"
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
import { AnnotationHighlight } from "@/lib/editor/annotation-highlight"

export const WRITING_BODY_EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  Strike,
  HorizontalRule,
  AnnotationHighlight,
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

const HEADING_LINE = /^(#{1,6})\s+(.*)$/
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/
const TABLE_ROW = /^\|(.+)\|$/
const TABLE_SEPARATOR_ROW = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/

const parseTableRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())

/**
 * `bodyText` (the plainText a document falls back to when its richText is
 * missing or fails to parse — an older desktop-synced doc, a corrupt
 * snapshot) can still be raw markdown source. Recognizing headings, tables,
 * and block images here — not just paragraphs — keeps this fallback from
 * dumping "| a | b |" and "![alt](src)" as literal escaped text. A heading
 * is checked against the block's first line specifically (not only whole
 * single-line blocks) because source markdown commonly puts body text on
 * the very next line without a blank line in between; the rest of the block
 * still gets the same treatment recursively.
 */
const renderBlockHtml = (block: string): string => {
  const lines = block.split("\n")
  const trimmedLines = lines.map((line) => line.trim())

  if (lines.length >= 2 && TABLE_ROW.test(trimmedLines[0]) && TABLE_SEPARATOR_ROW.test(trimmedLines[1])) {
    const headerCells = parseTableRow(trimmedLines[0])
    const bodyRows = trimmedLines.slice(2).filter((line) => TABLE_ROW.test(line)).map(parseTableRow)
    const thead = `<thead><tr>${headerCells.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>`
    const tbody = `<tbody>${bodyRows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
      .join("")}</tbody>`
    return `<table>${thead}${tbody}</table>`
  }

  const headingMatch = trimmedLines[0].match(HEADING_LINE)
  if (headingMatch) {
    const level = headingMatch[1].length
    const headingHtml = `<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`
    const rest = lines.slice(1).join("\n")
    return rest.trim() ? headingHtml + renderBlockHtml(rest) : headingHtml
  }

  if (lines.length === 1) {
    const imageMatch = trimmedLines[0].match(IMAGE_LINE)
    if (imageMatch) {
      const [, alt, src] = imageMatch
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`
    }
  }

  return `<p>${lines.map(escapeHtml).join("<br />")}</p>`
}

export const renderPlainTextHtml = (bodyText: string | null | undefined) => {
  const normalized = sanitizeWritingBodyText(bodyText)

  if (!normalized) {
    return "<p></p>"
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(renderBlockHtml)

  return blocks.length > 0 ? containWideTables(blocks.join("")) : "<p></p>"
}

export const sanitizeRenderInputs = (
  bodyJson: JSONContent | null | undefined,
  bodyText: string | null | undefined,
) => ({
  bodyJson: sanitizeWritingBodyJson(bodyJson),
  bodyText: sanitizeWritingBodyText(bodyText),
})
