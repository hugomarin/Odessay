/**
 * Margins — pure utility functions
 *
 * Testable business logic extracted from the API routes and components.
 * No I/O, no Supabase, no browser APIs.
 */

import { z } from "zod"
import type { JSONContent } from "@tiptap/core"
import { extractWritingAnnotationNodes, type MarkdownAnnotation } from "@/lib/editor/footnote-extension"

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const createMarginSchema = z.object({
  writing_id: z.string().uuid(),
  anchor_start: z.number().int().min(0),
  anchor_end: z.number().int().min(1),
  anchor_text: z.string().min(1),
  type: z.enum(["personal", "ai", "footnote"]).default("personal"),
  text: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})

export const patchMarginNoteSchema = z
  .object({
    text: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .refine((value) => value.text !== undefined || value.note !== undefined, {
    message: "At least one of text or note is required.",
  })

export const patchMarginShareSchema = z.object({
  shared: z.boolean(),
})

export const shareMarginsBatchSchema = z.object({
  writing_id: z.string().uuid(),
})

export const marginRecordSchema = z.object({
  id: z.string().uuid(),
  writing_id: z.string().uuid(),
  reader_id: z.string().uuid(),
  anchor_start: z.number().int().min(0),
  anchor_end: z.number().int().min(0),
  anchor_text: z.string(),
  type: z.enum(["personal", "ai", "collaborative"]),
  text: z.string(),
  note: z.string().nullable().optional(),
  shared: z.boolean().default(false),
  shared_at: z.string().nullable().optional(),
  archived: z.boolean().default(false),
  resolved: z.boolean().default(false),
})

export type MarginRecord = z.infer<typeof marginRecordSchema>

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

export function countTypedAnnotations(
  margins: Array<{ type: "personal" | "ai" | "collaborative" }>,
  type: "personal" | "ai" | "collaborative",
) {
  return margins.filter((margin) => margin.type === type).length
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

type SyncRow = Pick<
  MarginRecord,
  | "id"
  | "writing_id"
  | "reader_id"
  | "anchor_start"
  | "anchor_end"
  | "anchor_text"
  | "type"
  | "text"
  | "note"
>

export const buildMarginSyncRows = (
  bodyJson: JSONContent | null | undefined,
  writingId: string,
  readerId: string,
): SyncRow[] =>
  extractWritingAnnotationNodes(bodyJson)
    .filter(
      (
        annotation,
      ): annotation is typeof annotation & { type: "personal" | "ai" | "collaborative" } =>
        annotation.type !== "footnote",
    )
    .map((annotation) => ({
      id: annotation.id,
      writing_id: writingId,
      reader_id: readerId,
      anchor_start: annotation.anchor_start,
      anchor_end: annotation.anchor_end,
      anchor_text: annotation.anchor_text,
      type: annotation.type,
      text: annotation.text,
      note: annotation.text,
    }))

export async function syncMarginsFromBodyJson(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  {
    bodyJson,
    writingId,
    readerId,
  }: {
    bodyJson: JSONContent | null | undefined
    writingId: string
    readerId: string
  },
) {
  const syncRows = buildMarginSyncRows(bodyJson, writingId, readerId)

  if (syncRows.length > 0) {
    const { error: upsertError } = await supabase.from("margins").upsert(syncRows, { onConflict: "id" })
    if (upsertError) {
      throw upsertError
    }
  }

  const ids = syncRows.map((row) => row.id)
  let deleteQuery = supabase.from("margins").delete().eq("writing_id", writingId).eq("reader_id", readerId)

  if (ids.length > 0) {
    deleteQuery = deleteQuery.not("id", "in", `(${ids.join(",")})`)
  }

  const { error: deleteError } = await deleteQuery
  if (deleteError) {
    throw deleteError
  }

  const { data, error } = await supabase
    .from("margins")
    .select("id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, type, text, note, shared, shared_at, archived, resolved, created_at, updated_at")
    .eq("writing_id", writingId)
    .eq("reader_id", readerId)
    .order("anchor_start", { ascending: true })

  if (error) {
    throw error
  }

  return data as MarginRecord[]
}

export const filterCopyableAnnotations = (annotations: MarkdownAnnotation[], type: "ai") =>
  annotations.filter((annotation) => annotation.type === type)
