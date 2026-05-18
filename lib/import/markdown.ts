import { Editor } from "@tiptap/core"
import { createEditorExtensions } from "@/lib/editor/extensions"
import type { JSONContent } from "@tiptap/core"

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

export type ImportResult = {
  body_json: JSONContent
  body_text: string
  title: string
}

const EMPTY = ""
const SPACE = " "
const NEWLINE = "\n"
const UNTITLED = "Untitled"
const BLOCK_SEP = "\n"
const ERR_SIZE_PREFIX = "File is too large ("
const ERR_SIZE_SUFFIX = "KB). Maximum supported size is 5MB."

const titleFromFileName = (fileName: string): string => {
  const withoutExt = fileName.replace(/\.(md|txt)$/i, EMPTY)
  return withoutExt.replace(/[-_]+/g, SPACE).trim() || UNTITLED
}

const extractTitleFromMarkdown = (markdown: string, fileName: string): string => {
  const h1Match = markdown.match(/^# (.+)$/m)
  if (h1Match) {
    return h1Match[1].trim().slice(0, 120)
  }

  const lines = markdown.split(NEWLINE)
  for (const line of lines) {
    const text = line.replace(/^[#*\->|\s]+/, EMPTY).trim()
    if (text.length > 0) {
      return text.slice(0, 120)
    }
  }

  return titleFromFileName(fileName)
}

const parseMarkdownWithEditor = (markdown: string): { body_json: JSONContent; body_text: string } => {
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: markdown,
  })

  const body_json = editor.getJSON()
  const body_text = editor.getText({ blockSeparator: BLOCK_SEP })
  editor.destroy()

  return { body_json, body_text }
}

export const parseMarkdownFile = async (file: File): Promise<ImportResult> => {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const kb = Math.round(file.size / 1024)
    throw new Error(ERR_SIZE_PREFIX + kb + ERR_SIZE_SUFFIX)
  }

  const markdown = await file.text()

  const { body_json, body_text } = parseMarkdownWithEditor(markdown)

  const title = extractTitleFromMarkdown(markdown, file.name)

  return { body_json, body_text, title }
}
