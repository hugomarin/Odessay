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
import History from "@tiptap/extension-history"
import Italic from "@tiptap/extension-italic"
import Link from "@tiptap/extension-link"
import ListItem from "@tiptap/extension-list-item"
import OrderedList from "@tiptap/extension-ordered-list"
import Paragraph from "@tiptap/extension-paragraph"
import Placeholder from "@tiptap/extension-placeholder"
import Strike from "@tiptap/extension-strike"
import Text from "@tiptap/extension-text"
import { Markdown } from "tiptap-markdown"
import { FootnoteExtension } from "@/lib/editor/footnote-extension"

export const EMPTY_EDITOR_JSON: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
}

export const createEditorExtensions = (): Extensions => [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  Strike,
  Highlight,
  Link.configure({
    openOnClick: false,
    autolink: true,
    protocols: ["http", "https", "mailto"],
  }),
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  Code,
  CodeBlock,
  Markdown.configure({
    transformPastedText: true,
    transformCopiedText: true,
    breaks: true,
    linkify: true,
  }),
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
