import type { Extensions, JSONContent } from "@tiptap/core"
import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import BulletList from "@tiptap/extension-bullet-list"
import CharacterCount from "@tiptap/extension-character-count"
import Code from "@tiptap/extension-code"
import CodeBlock from "@tiptap/extension-code-block"
import Document from "@tiptap/extension-document"
import Heading from "@tiptap/extension-heading"
import History from "@tiptap/extension-history"
import HorizontalRule from "@tiptap/extension-horizontal-rule"
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
import {
  TableOfContents,
  getHierarchicalIndexes,
  type TableOfContentData,
} from "@tiptap/extension-table-of-contents"
import { TableRow } from "@tiptap/extension-table-row"
import Text from "@tiptap/extension-text"
import { Markdown } from "tiptap-markdown"
import { FindReplaceExtension } from "@/lib/editor/find-replace"
import { FootnoteExtension } from "@/lib/editor/footnote-extension"
import { AnnotationReferenceNode } from "@/lib/editor/footnote-node"
import { CorrectionTriggerExtension } from "@/lib/editor/correction-trigger-plugin"
import { FrontmatterNode } from "@/lib/editor/frontmatter-node"
import { PublicationSuggestionExtension } from "@/lib/editor/publication-suggestion-extension"
import { AnnotationHighlight } from "@/lib/editor/annotation-highlight"
import {
  LocalImageExtension,
  type LocalImageBackupRequest,
  type ResolvedLocalImage,
} from "@/lib/editor/local-image-extension"

export const EMPTY_EDITOR_JSON: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
}

type CreateEditorExtensionsOptions = {
  onTableOfContentsUpdate?: (items: TableOfContentData) => void
  tableOfContentsScrollParent?: () => HTMLElement | Window
  resolveImage?: (source: string) => Promise<ResolvedLocalImage>
  onRequestLocalImageBackup?: (request: LocalImageBackupRequest) => void
}

export const createEditorExtensions = (options: CreateEditorExtensionsOptions = {}): Extensions => {
  const tableOfContentsExtensions: Extensions = options.onTableOfContentsUpdate
    ? [
        TableOfContents.configure({
          anchorTypes: ["heading"],
          getIndex: getHierarchicalIndexes,
          scrollParent: () => {
            if (options.tableOfContentsScrollParent) {
              return options.tableOfContentsScrollParent()
            }

            return window
          },
          onUpdate: (items) => {
            options.onTableOfContentsUpdate?.(items)
          },
        }),
      ]
    : []

  return [
    Document,
    Paragraph,
    Text,
    Heading.extend({ addKeyboardShortcuts: () => ({}) }).configure({ levels: [1, 2, 3] }),
    Bold.extend({ addKeyboardShortcuts: () => ({}) }),
    Italic.extend({ addKeyboardShortcuts: () => ({}) }),
    Strike.extend({ addKeyboardShortcuts: () => ({}) }),
    AnnotationHighlight.extend({ addKeyboardShortcuts: () => ({}) }),
    LocalImageExtension.extend({ addKeyboardShortcuts: () => ({}) }).configure({
      allowBase64: false,
      inline: false,
      resolveImage: options.resolveImage,
      onRequestBackup: options.onRequestLocalImageBackup,
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
    ...tableOfContentsExtensions,
    FindReplaceExtension,
    CorrectionTriggerExtension,
    PublicationSuggestionExtension,
    FrontmatterNode,
    AnnotationReferenceNode,
    FootnoteExtension,
    History,
    HorizontalRule.extend({ addKeyboardShortcuts: () => ({}) }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? "Heading..." : ""),
    }),
    CharacterCount,
  ]
}

export const getEditorMarkdown = (editor: { storage: unknown }) => {
  const markdownStorage = (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown

  if (typeof markdownStorage?.getMarkdown !== "function") {
    return ""
  }

  return markdownStorage.getMarkdown()
}
