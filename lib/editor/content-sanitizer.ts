import type { JSONContent } from "@tiptap/core"

const CITATION_ARTIFACT_REGEX = /⊠cite⊠(?:turn[^\s⊠]+⊠)+/g

const sanitizeText = (value: string) => value.replace(CITATION_ARTIFACT_REGEX, "").replace(/\s{3,}/g, "  ")

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
