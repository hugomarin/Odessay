import { Editor } from "@tiptap/core"
import type { JSONContent } from "@tiptap/core"
import { EMPTY_EDITOR_JSON, createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions"
import { getEditorFootnotes, getMarkdownWithFootnoteDefinitions } from "@/lib/editor/footnote-node"
import {
  materializeMarkdownForRichParser,
  normalizeMarkdownForRoundTrip,
} from "@/lib/editor/markdown-format"

export type DocumentSerializationSnapshot = {
  bodyJson: JSONContent
  bodyText: string
  markdown: string
}

const BLOCK_SEPARATOR = "\n"

const createDocumentEditor = (content: JSONContent | string) =>
  new Editor({
    extensions: createEditorExtensions(),
    content,
  })

export const serializeEditorToMarkdown = (editor: Editor) =>
  normalizeMarkdownForRoundTrip(
    getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)),
  )

export const serializeDocumentToMarkdown = (bodyJson: JSONContent | null | undefined): string => {
  if (!bodyJson) {
    return ""
  }

  const editor = createDocumentEditor(bodyJson)
  try {
    return serializeEditorToMarkdown(editor)
  } finally {
    editor.destroy()
  }
}

export const serializeDocumentToSnapshot = (
  bodyJson: JSONContent | null | undefined,
): DocumentSerializationSnapshot => {
  const editor = createDocumentEditor(bodyJson ?? EMPTY_EDITOR_JSON)

  try {
    return {
      bodyJson: editor.getJSON(),
      bodyText: editor.getText({ blockSeparator: BLOCK_SEPARATOR }),
      markdown: serializeEditorToMarkdown(editor),
    }
  } finally {
    editor.destroy()
  }
}

export const parseMarkdownToSnapshot = (markdown: string): DocumentSerializationSnapshot => {
  const normalizedMarkdown = normalizeMarkdownForRoundTrip(markdown)
  const editor = createDocumentEditor(materializeMarkdownForRichParser(normalizedMarkdown))

  try {
    return {
      bodyJson: editor.getJSON(),
      bodyText: editor.getText({ blockSeparator: BLOCK_SEPARATOR }),
      markdown: serializeEditorToMarkdown(editor),
    }
  } finally {
    editor.destroy()
  }
}
