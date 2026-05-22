import type { Extensions, JSONContent } from "@tiptap/core"
import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import BulletList from "@tiptap/extension-bullet-list"
import CharacterCount from "@tiptap/extension-character-count"
import Code from "@tiptap/extension-code"
import CodeBlock from "@tiptap/extension-code-block"
import Document from "@tiptap/extension-document"
import Heading from "@tiptap/extension-heading"
import Highlight from "@tiptap/extension-highlight"
import Image from "@tiptap/extension-image"
import History from "@tiptap/extension-history"
import Italic from "@tiptap/extension-italic"
import Link from "@tiptap/extension-link"
import ListItem from "@tiptap/extension-list-item"
import OrderedList from "@tiptap/extension-ordered-list"
import Paragraph from "@tiptap/extension-paragraph"
import Placeholder from "@tiptap/extension-placeholder"
import Strike from "@tiptap/extension-strike"
import { Table } from "@tiptap/extension-table"
import { TableCell } from "@tiptap/extension-table-cell"
import { TableHeader } from "@tiptap/extension-table-header"
import { TableRow } from "@tiptap/extension-table-row"
import Text from "@tiptap/extension-text"
import { Markdown } from "tiptap-markdown"
import { FindReplaceExtension } from "@/lib/editor/find-replace"
import { FootnoteExtension } from "@/lib/editor/footnote-extension"
import { AnnotationReferenceNode } from "@/lib/editor/footnote-node"
import { CorrectionTriggerExtension } from "@/lib/editor/correction-trigger-plugin"
import { PublicationSuggestionExtension } from "@/lib/editor/publication-suggestion-extension"

export const EMPTY_EDITOR_JSON: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
}

export const createEditorExtensions = (): Extensions => [
  Document,
  Paragraph,
  Text,
  Heading.extend({ addKeyboardShortcuts: () => ({}) }).configure({ levels: [1, 2, 3] }),
  Bold.extend({ addKeyboardShortcuts: () => ({}) }),
  Italic.extend({ addKeyboardShortcuts: () => ({}) }),
  Strike.extend({ addKeyboardShortcuts: () => ({}) }),
  Highlight.extend({ addKeyboardShortcuts: () => ({}) }),
  Image.extend({ addKeyboardShortcuts: () => ({}) }).configure({
    allowBase64: false,
    inline: false,
  }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    protocols: ["http", "https", "mailto"],
  }),
  Blockquote.extend({ addKeyboardShortcuts: () => ({}) }),
  BulletList.extend({ addKeyboardShortcuts: () => ({}) }),
  OrderedList.extend({ addKeyboardShortcuts: () => ({}) }),
  ListItem,
  Code.extend({ addKeyboardShortcuts: () => ({}) }),
  CodeBlock.extend({ addKeyboardShortcuts: () => ({}) }),
  Markdown.configure({
    transformPastedText: true,
    transformCopiedText: true,
    breaks: true,
    linkify: true,
  }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  FindReplaceExtension,
  CorrectionTriggerExtension,
  PublicationSuggestionExtension,
  AnnotationReferenceNode,
  FootnoteExtension,
  History,
  Placeholder.configure({
    placeholder: ({ node }) => (node.type.name === "heading" ? "Heading..." : ""),
  }),
  CharacterCount,
]

export const getEditorMarkdown = (editor: { storage: unknown }) => {
  const markdownStorage = (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown

  if (typeof markdownStorage?.getMarkdown !== "function") {
    return ""
  }

  return markdownStorage.getMarkdown()
}
