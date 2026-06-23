import { Editor } from "@tiptap/core"
import type { JSONContent } from "@tiptap/core"
import { dump, load } from "js-yaml"
import { EMPTY_EDITOR_JSON, createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions"
import {
  normalizeCanonicalDocumentMetadata,
  type CanonicalDocumentMetadata,
} from "@/lib/editor/document-profile"
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

export type CanonicalDocumentFileSnapshot = {
  metadata: CanonicalDocumentMetadata | null
  snapshot: DocumentSerializationSnapshot
  markdown: string
}

const BLOCK_SEPARATOR = "\n"
const FRONTMATTER_DELIMITER = "---"

const createDocumentEditor = (content: JSONContent | string) =>
  new Editor({
    extensions: createEditorExtensions(),
    content,
  })

const normalizeLineEndings = (value: string) => value.replace(/\r\n?/g, "\n")

const splitCanonicalDocumentSource = (
  source: string,
): { frontmatter: string | null; markdown: string } => {
  const normalizedSource = normalizeLineEndings(source)

  if (!normalizedSource.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return { frontmatter: null, markdown: normalizedSource }
  }

  const closingIndex = normalizedSource.indexOf(`\n${FRONTMATTER_DELIMITER}\n`, FRONTMATTER_DELIMITER.length + 1)
  if (closingIndex === -1) {
    return { frontmatter: null, markdown: normalizedSource }
  }

  return {
    frontmatter: normalizedSource.slice(FRONTMATTER_DELIMITER.length + 1, closingIndex),
    markdown: normalizedSource
      .slice(closingIndex + `\n${FRONTMATTER_DELIMITER}\n`.length)
      .replace(/^\n/, ""),
  }
}

const parseCanonicalFrontmatter = (frontmatter: string): CanonicalDocumentMetadata | null => {
  const parsed = load(frontmatter)

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Record<string, unknown>
  const rawId = typeof record.id === "string" ? record.id.trim() : ""
  if (!rawId) {
    return null
  }

  const readIsoString = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      return value
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString()
    }

    return undefined
  }

  return normalizeCanonicalDocumentMetadata({
    id: rawId,
    slug: typeof record.slug === "string" ? record.slug : null,
    status: typeof record.status === "string" ? record.status : undefined,
    visibility: typeof record.visibility === "string" ? record.visibility : undefined,
    version: typeof record.version === "number" ? record.version : undefined,
    createdAt: readIsoString(record.created_at),
    updatedAt: readIsoString(record.updated_at),
  })
}

const restoreForeignFrontmatter = (frontmatter: string, markdown: string) =>
  `${FRONTMATTER_DELIMITER}\n${frontmatter}\n${FRONTMATTER_DELIMITER}${markdown ? `\n\n${markdown}` : ""}`

const normalizeDocumentMarkdown = (source: string) => {
  const { frontmatter, markdown } = splitCanonicalDocumentSource(source)

  if (frontmatter && !parseCanonicalFrontmatter(frontmatter)) {
    return restoreForeignFrontmatter(frontmatter, normalizeMarkdownForRoundTrip(markdown))
  }

  return normalizeMarkdownForRoundTrip(frontmatter ? markdown : source)
}

const materializeDocumentMarkdown = (source: string) => {
  const { frontmatter, markdown } = splitCanonicalDocumentSource(source)

  if (frontmatter && !parseCanonicalFrontmatter(frontmatter)) {
    return restoreForeignFrontmatter(frontmatter, materializeMarkdownForRichParser(markdown))
  }

  return materializeMarkdownForRichParser(frontmatter ? markdown : source)
}

export const serializeCanonicalFrontmatter = (metadata: CanonicalDocumentMetadata): string => {
  const normalized = normalizeCanonicalDocumentMetadata(metadata)
  const yaml = dump(
    {
      id: normalized.id,
      slug: normalized.slug,
      status: normalized.status,
      visibility: normalized.visibility,
      version: normalized.version,
      created_at: normalized.createdAt,
      updated_at: normalized.updatedAt,
    },
    { lineWidth: -1, noRefs: true, sortKeys: false },
  ).trimEnd()

  return `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}`
}

export const serializeEditorToMarkdown = (editor: Editor) =>
  normalizeDocumentMarkdown(
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
  const editor = createDocumentEditor(materializeDocumentMarkdown(markdown))

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

export const serializeDocumentFile = (
  bodyJson: JSONContent | null | undefined,
  metadata: CanonicalDocumentMetadata,
): string => {
  void metadata
  return serializeDocumentToMarkdown(bodyJson)
}

export const parseDocumentFileToSnapshot = (source: string): CanonicalDocumentFileSnapshot => {
  const { frontmatter, markdown } = splitCanonicalDocumentSource(source)
  const metadata = frontmatter ? parseCanonicalFrontmatter(frontmatter) : null
  const markdownSource = metadata ? markdown : source

  return {
    metadata,
    snapshot: parseMarkdownToSnapshot(markdownSource),
    markdown: normalizeMarkdownForRoundTrip(markdownSource),
  }
}
