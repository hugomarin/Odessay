import type { JSONContent } from "@tiptap/core"
import { serializeDocumentToMarkdown } from "@/lib/editor/document-serialization"
import { getExportFileBaseName, sanitizeFileName } from "./writing-export"

export const serializeWritingToMarkdown = (bodyJson: JSONContent | null | undefined) =>
  serializeDocumentToMarkdown(bodyJson)

export const buildMarkdownDownloadName = (params: {
  title?: string | null
  bodyText?: string | null
  writingId: string
}) => `${getExportFileBaseName(params)}.md`

export const sanitizeMarkdownDownloadName = sanitizeFileName
