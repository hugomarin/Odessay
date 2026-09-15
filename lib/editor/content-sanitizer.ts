import type { JSONContent } from "@tiptap/core"

const CITATION_ARTIFACT_REGEX = /⊠cite⊠(?:turn[^\s⊠]+⊠)+/g

// Collapsing runs of 3+ whitespace used to include newlines, which ate a
// markdown document's own paragraph/section breaks whenever an author left
// more than one blank line between them (common in exported/authored
// markdown) — three or more "\n" collapsed to two literal spaces, joining
// what should have been separate blocks (including headings and tables) into
// one run-on paragraph before the plain-text fallback ever saw a boundary to
// split on. Horizontal whitespace (spaces/tabs) still collapses the same
// way; runs of blank lines collapse down to exactly one blank line instead.
const sanitizeText = (value: string) =>
  value
    .replace(CITATION_ARTIFACT_REGEX, "")
    .replace(/[ \t]{3,}/g, "  ")
    .replace(/\n{3,}/g, "\n\n")

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const sanitizeValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return sanitizeText(value)
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue)
  }

  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {}

    for (const [key, child] of Object.entries(value)) {
      next[key] = key === "text" ? sanitizeValue(child) : sanitizeValue(child)
    }

    return next
  }

  return value
}

export const sanitizeWritingBodyText = (value: string | null | undefined) => sanitizeText(value ?? "")

export const sanitizeWritingBodyJson = (value: JSONContent | null | undefined): JSONContent | null => {
  if (!isPlainObject(value)) {
    return null
  }

  return sanitizeValue(value) as JSONContent
}
