import type { JSONContent } from "@tiptap/core"
import type { ImportResult } from "@/lib/import/markdown"

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

const ERR_TOO_LARGE_PREFIX = "File is too large ("
const ERR_TOO_LARGE_SUFFIX = "KB). Maximum supported size is 5MB."
const SPACE = " "
const NEWLINE_STR = "\n"
const EMPTY_STR = ""
const UNTITLED_STR = "Untitled"

const PARA_TYPE = "paragraph"
const TEXT_TYPE = "text"
const DOC_TYPE = "doc"

const buildParagraph = (text: string): JSONContent => ({
  type: PARA_TYPE,
  content: text.length > 0 ? [{ type: TEXT_TYPE, text }] : undefined,
})

const buildDocumentJSON = (paragraphs: string[]): JSONContent => ({
  type: DOC_TYPE,
  content: paragraphs.length > 0 ? paragraphs.map(buildParagraph) : [{ type: PARA_TYPE }],
})

export const parsePlainTextFile = async (file: File): Promise<ImportResult> => {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const kb = Math.round(file.size / 1024)
    throw new Error(ERR_TOO_LARGE_PREFIX + kb + ERR_TOO_LARGE_SUFFIX)
  }

  const raw = await file.text()

  // Split on double newlines to preserve paragraph breaks
  const paragraphs = raw
    .split(/\r?\n\r?\n/)
    .map((block) => block.replace(/\r?\n/g, SPACE).trim())
    .filter((block) => block.length > 0)

  const body_json = buildDocumentJSON(paragraphs)
  const body_text = paragraphs.join(NEWLINE_STR)

  // Derive title from first non-empty line or file name
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim().length > 0)
  const titleFromContent = firstLine?.trim().slice(0, 120) ?? EMPTY_STR

  const fileTitle = file.name
    .replace(/\.txt$/i, EMPTY_STR)
    .replace(/[-_]+/g, SPACE)
    .trim()

  const title = titleFromContent || fileTitle || UNTITLED_STR

  return { body_json, body_text, title }
}
