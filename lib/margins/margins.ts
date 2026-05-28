/**
 * Margins — pure utility functions
 *
 * Testable business logic extracted from the API routes and components.
 * No I/O, no Supabase, no browser APIs.
 */

import { z } from "zod"
import type { JSONContent } from "@tiptap/core"
import type { SupabaseClient } from "@supabase/supabase-js"
import { extractWritingAnnotationNodes, type MarkdownAnnotation } from "@/lib/editor/footnote-extension"

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const createMarginSchema = z.object({
  writing_id: z.string().uuid(),
  anchor_start: z.number().int().min(0),
  anchor_end: z.number().int().min(1),
  anchor_text: z.string().min(1),
  type: z.enum(["personal", "ai", "footnote", "highlight"]).default("personal"),
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
  reader_id: z.string().uuid().nullable().optional(),
  anchor_start: z.number().int().min(0),
  anchor_end: z.number().int().min(0),
  anchor_text: z.string(),
  type: z.enum(["personal", "ai", "collaborative", "highlight"]),
  text: z.string(),
  note: z.string().nullable().optional(),
  shared: z.boolean().default(false),
  shared_at: z.string().nullable().optional(),
  archived: z.boolean().default(false),
  resolved: z.boolean().default(false),
})

export type MarginRecord = z.infer<typeof marginRecordSchema>

type MarginsSupabaseClient = Pick<SupabaseClient, "from">

type MarginLegacyRow = {
  id: string
  writing_id: string
  reader_id?: string
  anchor_start: number
  anchor_end: number
  anchor_text: string
  note?: string | null
  shared: boolean
  shared_at?: string | null
  created_at: string
  updated_at?: string
}

type MarginRuntimeRow = Partial<MarginRecord> & MarginLegacyRow

const MODERN_MARGIN_SELECT =
  "id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, type, text, note, shared, shared_at, archived, resolved, created_at, updated_at"

const LEGACY_MARGIN_SELECT =
  "id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, note, shared, shared_at, created_at, updated_at"

const LEGACY_PREVIEW_MARGIN_SELECT =
  "id, writing_id, anchor_start, anchor_end, anchor_text, note, shared, shared_at, created_at, updated_at"

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
  margins: Array<{ type: "personal" | "ai" | "collaborative" | "highlight" }>,
  type: "personal" | "ai" | "collaborative" | "highlight",
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

export function isLegacyMarginsSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : null
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : ""
  const details =
    "details" in error && typeof error.details === "string"
      ? error.details.toLowerCase()
      : ""
  const combined = `${message} ${details}`
  const missingLegacyColumns = ["type", "text", "archived", "resolved"]
  const mentionsMargins = combined.includes("margins")
  const mentionsMissingColumn = /(column|schema cache|could not find)/.test(combined)
  const mentionsLegacyColumn = missingLegacyColumns.some((column) =>
    combined.includes(`"${column}"`) ||
    combined.includes(`'${column}'`) ||
    combined.includes(`.${column}`) ||
    combined.includes(` ${column} `) ||
    combined.endsWith(` ${column}`),
  )

  if (!mentionsMargins || !mentionsMissingColumn || !mentionsLegacyColumn) {
    return false
  }

  return code == null || code === "42703" || code.startsWith("PGRST")
}

export function normalizeMarginRecord(row: MarginRuntimeRow): MarginRecord {
  const note = row.note ?? row.text ?? null

  return {
    id: row.id,
    writing_id: row.writing_id,
    reader_id: row.reader_id ?? null,
    anchor_start: row.anchor_start,
    anchor_end: row.anchor_end,
    anchor_text: row.anchor_text,
    type: row.type ?? "personal",
    text: row.text ?? note ?? "",
    note,
    shared: row.shared,
    shared_at: row.shared_at ?? null,
    archived: row.archived ?? false,
    resolved: row.resolved ?? false,
  }
}

async function selectOwnedMargins(
  supabase: MarginsSupabaseClient,
  writingId: string,
  readerId: string,
) {
  const modern = await supabase
    .from("margins")
    .select(MODERN_MARGIN_SELECT)
    .eq("writing_id", writingId)
    .eq("reader_id", readerId)
    .order("anchor_start", { ascending: true })

  if (!modern.error) {
    return (modern.data ?? []) as MarginRuntimeRow[]
  }

  if (!isLegacyMarginsSchemaError(modern.error)) {
    throw modern.error
  }

  const legacy = await supabase
    .from("margins")
    .select(LEGACY_MARGIN_SELECT)
    .eq("writing_id", writingId)
    .eq("reader_id", readerId)
    .order("anchor_start", { ascending: true })

  if (legacy.error) {
    throw legacy.error
  }

  return (legacy.data ?? []) as MarginRuntimeRow[]
}

async function selectAccessibleMargins(
  supabase: MarginsSupabaseClient,
  writingId: string,
) {
  const modern = await supabase
    .from("margins")
    .select(MODERN_MARGIN_SELECT)
    .eq("writing_id", writingId)
    .order("anchor_start", { ascending: true })

  if (!modern.error) {
    return (modern.data ?? []) as MarginRuntimeRow[]
  }

  if (!isLegacyMarginsSchemaError(modern.error)) {
    throw modern.error
  }

  const legacy = await supabase
    .from("margins")
    .select(LEGACY_MARGIN_SELECT)
    .eq("writing_id", writingId)
    .order("anchor_start", { ascending: true })

  if (legacy.error) {
    throw legacy.error
  }

  return (legacy.data ?? []) as MarginRuntimeRow[]
}

export async function getOwnedMargins(
  supabase: MarginsSupabaseClient,
  writingId: string,
  readerId: string,
): Promise<MarginRecord[]> {
  const rows = await selectOwnedMargins(supabase, writingId, readerId)
  return rows.map((row) => normalizeMarginRecord({ ...row, reader_id: row.reader_id ?? readerId }))
}

export async function getAccessibleMargins(
  supabase: MarginsSupabaseClient,
  writingId: string,
): Promise<MarginRecord[]> {
  const rows = await selectAccessibleMargins(supabase, writingId)
  return rows.map((row) => normalizeMarginRecord(row))
}

export async function getPreviewSharedMargins(
  supabase: MarginsSupabaseClient,
  writingId: string,
) {
  const modern = await supabase
    .from("margins")
    .select("id, writing_id, anchor_start, anchor_end, anchor_text, type, text, note, shared, shared_at, archived, resolved, created_at, updated_at")
    .eq("writing_id", writingId)
    .eq("shared", true)
    .order("anchor_start", { ascending: true })

  if (!modern.error) {
    return (modern.data ?? []).map((row: MarginRuntimeRow) => normalizeMarginRecord(row))
  }

  if (!isLegacyMarginsSchemaError(modern.error)) {
    throw modern.error
  }

  const legacy = await supabase
    .from("margins")
    .select(LEGACY_PREVIEW_MARGIN_SELECT)
    .eq("writing_id", writingId)
    .eq("shared", true)
    .order("anchor_start", { ascending: true })

  if (legacy.error) {
    throw legacy.error
  }

  return (legacy.data ?? []).map((row: MarginRuntimeRow) => normalizeMarginRecord(row))
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
      ): annotation is typeof annotation & { type: "personal" | "ai" | "collaborative" | "highlight" } =>
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
  supabase: MarginsSupabaseClient,
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
    if (upsertError && !isLegacyMarginsSchemaError(upsertError)) {
      throw upsertError
    }

    if (upsertError) {
      const legacyRows = syncRows.map((row) => ({
        id: row.id,
        writing_id: row.writing_id,
        reader_id: row.reader_id,
        anchor_start: row.anchor_start,
        anchor_end: row.anchor_end,
        anchor_text: row.anchor_text,
        note: row.note ?? row.text ?? null,
      }))
      const { error: legacyUpsertError } = await supabase.from("margins").upsert(legacyRows, { onConflict: "id" })
      if (legacyUpsertError) {
        throw legacyUpsertError
      }
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

  return getOwnedMargins(supabase, writingId, readerId)
}

export const filterCopyableAnnotations = (annotations: MarkdownAnnotation[], type: "ai") =>
  annotations.filter((annotation) => annotation.type === type)
