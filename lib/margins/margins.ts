/**
 * Margins — pure utility functions
 *
 * Testable business logic extracted from the API routes and components.
 * No I/O, no Supabase, no browser APIs.
 */

import { z } from "zod"

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const createMarginSchema = z.object({
  writing_id: z.string().uuid(),
  anchor_start: z.number().int().min(0),
  anchor_end: z.number().int().min(1),
  anchor_text: z.string().min(1),
  note: z.string().nullable().optional(),
})

export const patchMarginNoteSchema = z.object({
  note: z.string().nullable(),
})

export const patchMarginShareSchema = z.object({
  shared: z.boolean(),
})

export const shareMarginsBatchSchema = z.object({
  writing_id: z.string().uuid(),
})

// ─── Parse helpers ────────────────────────────────────────────────────────────

/** Validates and returns the payload for creating a margin; returns null on failure. */
export function parseCreateMarginPayload(
  body: unknown,
): z.infer<typeof createMarginSchema> | null {
  const result = createMarginSchema.safeParse(body)
  return result.success ? result.data : null
}

/** Validates and returns the payload for patching a margin note; returns null on failure. */
export function parsePatchMarginPayload(
  body: unknown,
): z.infer<typeof patchMarginNoteSchema> | null {
  const result = patchMarginNoteSchema.safeParse(body)
  return result.success ? result.data : null
}

/** Validates and returns the payload for toggling a margin's shared state; returns null on failure. */
export function parsePatchMarginSharePayload(
  body: unknown,
): z.infer<typeof patchMarginShareSchema> | null {
  const result = patchMarginShareSchema.safeParse(body)
  return result.success ? result.data : null
}

/** Validates and returns the payload for batch-sharing margins; returns null on failure. */
export function parseShareMarginsBatchPayload(
  body: unknown,
): z.infer<typeof shareMarginsBatchSchema> | null {
  const result = shareMarginsBatchSchema.safeParse(body)
  return result.success ? result.data : null
}

// ─── Domain rules ─────────────────────────────────────────────────────────────

/**
 * Returns true if the anchor range is valid (end > start, both ≥ 0).
 * Mirrors the Supabase CHECK constraints on the margins table.
 */
export function isValidAnchor(anchorStart: number, anchorEnd: number): boolean {
  return anchorStart >= 0 && anchorEnd > anchorStart
}

/**
 * Returns true if the reader can still edit a margin.
 * In v1 margins are always editable by the reader — shared margins are read-only for the author
 * but the reader can still edit them until they explicitly remove the share.
 */
export function canReaderEdit(readerId: string, marginReaderId: string): boolean {
  return readerId === marginReaderId
}

/**
 * Checks whether all margins in a set have been shared.
 * Returns false if the array is empty (nothing to share).
 */
export function areAllMarginsShared(margins: Array<{ shared: boolean }>): boolean {
  if (margins.length === 0) return false
  return margins.every((m) => m.shared)
}

/**
 * Returns the count of margins that have a non-null note (annotations).
 */
export function countAnnotations(margins: Array<{ note: string | null }>): number {
  return margins.filter((m) => m.note !== null).length
}

/**
 * Returns true if the margin has been shared.
 */
export function isShared(margin: { shared: boolean }): boolean {
  return margin.shared === true
}

/**
 * Toggles the shared state of a margin.
 * Returns the new shared value.
 */
export function toggleShare(currentShared: boolean): boolean {
  return !currentShared
}

/**
 * Given a list of margins and a preview token, returns only the shared margins.
 * The token is validated to be non-empty; if invalid, returns an empty array.
 */
export function getSharedForToken<T extends { shared: boolean }>(
  margins: T[],
  token: string,
): T[] {
  if (!token || token.trim().length === 0) return []
  return margins.filter((m) => m.shared)
}

/**
 * Sorts margins by anchor_start ascending (reading order).
 */
export function sortMarginsByPosition<T extends { anchor_start: number }>(margins: T[]): T[] {
  return [...margins].sort((a, b) => a.anchor_start - b.anchor_start)
}
