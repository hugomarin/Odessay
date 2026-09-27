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
    // A "blank" line carrying stray trailing whitespace (common from
    // pasted/exported markdown) isn't literally empty, so it survived as a
    // \n \n gap that \n{3,} below doesn't match — collapse it to a true
    // empty line first so it still counts as a blank-line boundary. Anchored
    // to sit strictly between two newlines (not just "^...$" on the whole
    // string): sanitizeValue runs this over every text node in richText
    // JSON too, where a standalone " " can be a legitimate one-space text
    // node between two inline marks — collapsing that to "" produced an
    // empty text node, which TipTap's schema rejects outright.
    .replace(/(?<=\n)[ \t]+(?=\n)/g, "")
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

const projectCleanReadingValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .filter(
        (child) =>
          !isPlainObject(child) ||
          (child.type !== "annotationReference" && child.type !== "footnoteReference"),
      )
      .map(projectCleanReadingValue)
  }

  if (!isPlainObject(value)) return value

  const next: Record<string, unknown> = { ...value }
  if (Array.isArray(value.marks)) {
    next.marks = value.marks
      .filter((mark) => {
        if (!isPlainObject(mark) || mark.type !== "highlight" || !isPlainObject(mark.attrs)) {
          return true
        }
        return !(
          mark.attrs.annotationId != null ||
          mark.attrs.annotationType != null ||
          mark.attrs.annotationComment != null
        )
      })
      .map(projectEntityReadingMark)
      .map(projectCleanReadingValue)
  }
  if (Array.isArray(value.content)) {
    next.content = projectCleanReadingValue(value.content)
  }
  return next
}

const projectEntityReadingMark = (mark: unknown): unknown => {
  if (!isPlainObject(mark) || mark.type !== "entity") {
    return mark
  }

  // Reading surfaces keep the accessible type styling but never the stable
  // entity ID or its internal ref (surface-projections.md, privacy policy).
  if (!isPlainObject(mark.attrs)) {
    return { type: mark.type, attrs: {} }
  }
  return {
    type: mark.type,
    attrs: { entityType: mark.attrs.entityType ?? "other" },
  }
}

export const sanitizeWritingBodyText = (value: string | null | undefined) => sanitizeText(value ?? "")

export const sanitizeWritingBodyJson = (value: JSONContent | null | undefined): JSONContent | null => {
  if (!isPlainObject(value)) {
    return null
  }

  return projectCleanReadingValue(sanitizeValue(value)) as JSONContent
}
