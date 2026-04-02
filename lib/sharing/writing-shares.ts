import { z } from "zod"

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validates and normalizes a user search query string.
 * Returns the trimmed query if valid (>= 2 chars), null otherwise.
 */
export function parseUserSearchQuery(q: unknown): string | null {
  if (typeof q !== "string") return null
  const trimmed = q.trim()
  if (trimmed.length < 2) return null
  return trimmed
}

const sharePayloadSchema = z.object({
  shared_with_id: z.string().uuid(),
})

export type SharePayload = z.infer<typeof sharePayloadSchema>

/**
 * Validates the body for POST/DELETE /api/writings/[id]/shares.
 * Returns the parsed payload or null if invalid.
 */
export function parseSharePayload(body: unknown): SharePayload | null {
  const result = sharePayloadSchema.safeParse(body)
  return result.success ? result.data : null
}

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

export type RawAuthorProfile = { username: string; display_name: string } | null

export type SharedWritingListItem = {
  id: string
  title: string | null
  slug: string | null
  excerpt: string
  updatedAt: string
  author: { username: string; displayName: string } | null
}

/**
 * Builds a display excerpt from body_text, truncating at word boundary.
 */
export function buildExcerpt(bodyText: string, maxLen = 120): string {
  const text = bodyText.trim()
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(" ")
  return lastSpace > 0 ? cut.slice(0, lastSpace) + "…" : cut + "…"
}

/**
 * Normalizes a raw DB row into a SharedWritingListItem for the /shared page.
 */
export function buildSharedWritingListItem(
  writing: { id: string; title: string | null; slug: string | null; body_text: string; updated_at: string },
  author: RawAuthorProfile,
): SharedWritingListItem {
  return {
    id: writing.id,
    title: writing.title,
    slug: writing.slug,
    excerpt: buildExcerpt(writing.body_text),
    updatedAt: writing.updated_at,
    author: author
      ? { username: author.username, displayName: author.display_name }
      : null,
  }
}
