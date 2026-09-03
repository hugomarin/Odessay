import type { SupabaseClient } from "@supabase/supabase-js"
import {
  BASE_VOCABULARY_ITEMS,
  getBaseVocabularyDefinition,
  isBaseVocabularyKey,
} from "@/lib/vocabulary/base-items"
import { isValidVocabularyColor, isValidVocabularyIcon, validateVocabularyItemFields } from "@/lib/vocabulary/validate"
import { slugifyVocabularyName } from "@/lib/vocabulary/key"
import type {
  CreateVocabularyItemInput,
  UpdateVocabularyItemInput,
  VocabularyItem,
  VocabularyKind,
  VocabularyUsage,
} from "@/lib/vocabulary/types"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseServerClient = SupabaseClient<any, any, any>

type VocabularyRow = {
  id: string
  kind: VocabularyKind
  key: string
  name: string
  description: string
  icon: string
  color: string
  hidden: boolean
  is_base: boolean
  is_required: boolean
  position: number
  created_at: string
  updated_at: string
}

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(code: ServiceError["code"], message: string, retryable = false): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable } }
}

/** A discarded-row event: the row failed the closed icon/color check and was dropped, not fatal (failure mode: "respuesta parcial"). */
function rowToItem(row: VocabularyRow): VocabularyItem | null {
  if (!isValidVocabularyIcon(row.kind, row.icon) || !isValidVocabularyColor(row.color)) {
    return null
  }
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    hidden: row.hidden,
    isBase: row.is_base,
    isRequired: row.is_required,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function syntheticBaseId(kind: VocabularyKind, key: string): string {
  return `base:${kind}:${key}`
}

function parseSyntheticBaseId(id: string): { kind: VocabularyKind; key: string } | null {
  const match = /^base:(type|status):(.+)$/.exec(id)
  if (!match) return null
  return { kind: match[1] as VocabularyKind, key: match[2] }
}

/**
 * Materializes every base item the user does not yet have a row for.
 * Idempotent (`on conflict do nothing`) and cheap to call before every write —
 * this is the "lazy seed" of requirement 7: reads never write, the first write
 * does.
 */
async function ensureBaseItemsMaterialized(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<ServiceError | null> {
  const rows = BASE_VOCABULARY_ITEMS.map((def) => ({
    user_id: userId,
    kind: def.kind,
    key: def.key,
    name: def.name,
    description: def.description,
    icon: def.icon,
    color: def.color,
    hidden: false,
    is_base: true,
    is_required: def.isRequired,
    position: def.position,
  }))

  const { error } = await supabase
    .from("vocabulary_items")
    .upsert(rows, { onConflict: "user_id,kind,key", ignoreDuplicates: true })

  if (error) {
    return { code: "DB_ERROR", message: error.message, retryable: true }
  }
  return null
}

export async function listVocabulary(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<ServiceResponse<VocabularyItem[]>> {
  const { data, error } = await supabase
    .from("vocabulary_items")
    .select("*")
    .eq("user_id", userId)
    .order("kind", { ascending: true })
    .order("position", { ascending: true })

  if (error) {
    return err("DB_ERROR", error.message, true)
  }

  const rows = (data ?? []) as VocabularyRow[]
  const byKindKey = new Map(rows.map((row) => [`${row.kind}:${row.key}`, row]))

  const items: VocabularyItem[] = []
  for (const def of BASE_VOCABULARY_ITEMS) {
    const existing = byKindKey.get(`${def.kind}:${def.key}`)
    if (existing) {
      const mapped = rowToItem(existing)
      if (mapped) items.push(mapped)
      continue
    }
    items.push({
      id: syntheticBaseId(def.kind, def.key),
      kind: def.kind,
      key: def.key,
      name: def.name,
      description: def.description,
      icon: def.icon,
      color: def.color,
      hidden: false,
      isBase: true,
      isRequired: def.isRequired,
      position: def.position,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
  }

  // Custom (non-base) rows the user created.
  for (const row of rows) {
    if (row.is_base) continue
    const mapped = rowToItem(row)
    if (mapped) items.push(mapped)
  }

  return ok(items)
}

async function nextAvailableKey(
  supabase: SupabaseServerClient,
  userId: string,
  kind: VocabularyKind,
  name: string,
): Promise<string | null> {
  const base = slugifyVocabularyName(name)
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}_${attempt + 1}`
    const { data, error } = await supabase
      .from("vocabulary_items")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("key", candidate)
      .maybeSingle()
    if (error) return null
    if (!data) return candidate
  }
  return null
}

export async function createVocabularyItem(
  supabase: SupabaseServerClient,
  userId: string,
  input: CreateVocabularyItemInput,
): Promise<ServiceResponse<VocabularyItem>> {
  const fieldErrors = validateVocabularyItemFields(input.kind, {
    name: input.name,
    description: input.description ?? "",
    icon: input.icon,
    color: input.color,
  })
  if (fieldErrors.length > 0) {
    return err("INVALID_INPUT", fieldErrors.map((e) => e.message).join(" "))
  }

  const seedError = await ensureBaseItemsMaterialized(supabase, userId)
  if (seedError) return { data: null, error: seedError }

  const key = await nextAvailableKey(supabase, userId, input.kind, input.name)
  if (!key) {
    return err("DB_ERROR", "Could not derive a unique key for this item.", true)
  }

  const { count } = await supabase
    .from("vocabulary_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", input.kind)

  const { data, error } = await supabase
    .from("vocabulary_items")
    .insert({
      user_id: userId,
      kind: input.kind,
      key,
      name: input.name.trim(),
      description: input.description?.slice(0, 180) ?? "",
      icon: input.icon,
      color: input.color,
      hidden: false,
      is_base: false,
      is_required: false,
      position: (count ?? 0) + 1,
    })
    .select("*")
    .single()

  if (error) {
    return err("DB_ERROR", error.message, true)
  }

  const mapped = rowToItem(data as VocabularyRow)
  if (!mapped) {
    return err("DB_ERROR", "Created item failed validation on read-back.", false)
  }
  return ok(mapped)
}

async function resolveRow(
  supabase: SupabaseServerClient,
  userId: string,
  id: string,
): Promise<{ row: VocabularyRow | null; error: ServiceError | null }> {
  const synthetic = parseSyntheticBaseId(id)
  if (synthetic) {
    const seedError = await ensureBaseItemsMaterialized(supabase, userId)
    if (seedError) return { row: null, error: seedError }
    const { data, error } = await supabase
      .from("vocabulary_items")
      .select("*")
      .eq("user_id", userId)
      .eq("kind", synthetic.kind)
      .eq("key", synthetic.key)
      .maybeSingle()
    if (error) return { row: null, error: { code: "DB_ERROR", message: error.message, retryable: true } }
    return { row: (data as VocabularyRow) ?? null, error: null }
  }

  const { data, error } = await supabase
    .from("vocabulary_items")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle()
  if (error) return { row: null, error: { code: "DB_ERROR", message: error.message, retryable: true } }
  return { row: (data as VocabularyRow) ?? null, error: null }
}

export async function updateVocabularyItem(
  supabase: SupabaseServerClient,
  userId: string,
  id: string,
  input: UpdateVocabularyItemInput,
): Promise<ServiceResponse<VocabularyItem>> {
  const { row, error: resolveError } = await resolveRow(supabase, userId, id)
  if (resolveError) return { data: null, error: resolveError }
  if (!row) {
    return err("INVALID_INPUT", `Vocabulary item "${id}" was not found.`)
  }

  const fieldErrors = validateVocabularyItemFields(row.kind, {
    name: input.name,
    description: input.description,
    icon: input.icon,
    color: input.color,
  })
  if (fieldErrors.length > 0) {
    return err("INVALID_INPUT", fieldErrors.map((e) => e.message).join(" "))
  }

  if (input.hidden === true && row.is_required) {
    return err("INVALID_INPUT", `"${row.name}" is required and cannot be hidden.`)
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.description !== undefined) patch.description = input.description.slice(0, 180)
  if (input.icon !== undefined) patch.icon = input.icon
  if (input.color !== undefined) patch.color = input.color
  if (input.hidden !== undefined) patch.hidden = input.hidden

  const { data, error } = await supabase
    .from("vocabulary_items")
    .update(patch)
    .eq("id", row.id)
    .eq("user_id", userId)
    .select("*")
    .single()

  if (error) {
    return err("DB_ERROR", error.message, true)
  }

  const mapped = rowToItem(data as VocabularyRow)
  if (!mapped) {
    return err("DB_ERROR", "Updated item failed validation on read-back.", false)
  }
  return ok(mapped)
}

export async function deleteVocabularyItem(
  supabase: SupabaseServerClient,
  userId: string,
  id: string,
): Promise<ServiceResponse<{ rewrittenCount: number }>> {
  const synthetic = parseSyntheticBaseId(id)
  if (synthetic) {
    const def = getBaseVocabularyDefinition(synthetic.kind, synthetic.key)
    return err("INVALID_INPUT", `"${def?.name ?? synthetic.key}" is a base item and cannot be deleted.`)
  }

  const { row, error: resolveError } = await resolveRow(supabase, userId, id)
  if (resolveError) return { data: null, error: resolveError }
  if (!row) {
    return err("INVALID_INPUT", `Vocabulary item "${id}" was not found.`)
  }
  if (row.is_base) {
    return err("INVALID_INPUT", `"${row.name}" is a base item and cannot be deleted.`)
  }

  const { data, error } = await supabase.rpc("delete_vocabulary_item", { p_item_id: row.id })

  if (error) {
    return err("DB_ERROR", error.message, true)
  }

  return ok({ rewrittenCount: typeof data === "number" ? data : 0 })
}

/** Usage counts for `GET /api/user/vocabulary?usage=1` — how many writings currently carry each item's key. */
export async function getVocabularyUsage(
  supabase: SupabaseServerClient,
  userId: string,
  items: VocabularyItem[],
): Promise<ServiceResponse<VocabularyUsage>> {
  const { data, error } = await supabase
    .from("writings")
    .select("artifact_type, status")
    .eq("author_id", userId)

  if (error) {
    return err("DB_ERROR", error.message, true)
  }

  const typeCounts = new Map<string, number>()
  const statusCounts = new Map<string, number>()
  for (const row of (data ?? []) as { artifact_type: string; status: string }[]) {
    typeCounts.set(row.artifact_type, (typeCounts.get(row.artifact_type) ?? 0) + 1)
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1)
  }

  const usage: VocabularyUsage = {}
  for (const item of items) {
    const counts = item.kind === "type" ? typeCounts : statusCounts
    usage[item.id] = counts.get(item.key) ?? 0
  }

  return ok(usage)
}

/**
 * Requirement 4: a writing may only carry a `key` that belongs to the
 * author's vocabulary — a base value, or a custom item the author actually
 * created. Base values are always valid, even before the user's rows are
 * materialized (requirement 4: "Los valores base siguen siendo válidos
 * siempre, incluso si el usuario no tiene filas sembradas todavía").
 */
export async function validateVocabularyValue(
  supabase: SupabaseServerClient,
  userId: string,
  kind: VocabularyKind,
  key: string,
): Promise<ServiceError | null> {
  if (isBaseVocabularyKey(kind, key)) {
    return null
  }

  const { data, error } = await supabase
    .from("vocabulary_items")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("key", key)
    .maybeSingle()

  if (error) {
    return { code: "DB_ERROR", message: error.message, retryable: true }
  }
  if (!data) {
    const label = kind === "type" ? "artifact type" : "status"
    return { code: "INVALID_INPUT", message: `"${key}" is not a valid ${label} for this account.`, retryable: false }
  }
  return null
}

/**
 * Upserts a batch of vocabulary rows verbatim, keyed on (user_id, kind, key)
 * — used only by the desktop sign-in reconciler
 * (`lib/services/desktop/vocabulary-reconciler.ts`) to push its merge
 * winners to the cloud. Unlike `createVocabularyItem`, this preserves the
 * given `id`/`key`/`updatedAt` exactly rather than generating a fresh key —
 * reconciliation is converging an existing item, not creating a new one. One
 * request for the whole batch (Performance Contract: reactive fan-out).
 */
export async function upsertVocabularyItemRows(
  supabase: SupabaseServerClient,
  userId: string,
  items: VocabularyItem[],
): Promise<ServiceError | null> {
  if (items.length === 0) return null

  const rows = items.map((item) => ({
    user_id: userId,
    kind: item.kind,
    key: item.key,
    name: item.name,
    description: item.description,
    icon: item.icon,
    color: item.color,
    hidden: item.hidden,
    is_base: item.isBase,
    is_required: item.isRequired,
    position: item.position,
    updated_at: item.updatedAt,
  }))

  const { error } = await supabase.from("vocabulary_items").upsert(rows, { onConflict: "user_id,kind,key" })
  if (error) {
    return { code: "DB_ERROR", message: error.message, retryable: true }
  }
  return null
}

/** Derives the deprecated `disabledStatuses` field from vocabulary (hidden status items). */
export function deriveDisabledStatuses(items: VocabularyItem[]): string[] {
  return items.filter((item) => item.kind === "status" && item.hidden).map((item) => item.key)
}

/**
 * Legacy write path for `PATCH /api/user/settings` (requirement 13): applies
 * a `disabledStatuses` array as `hidden` on the matching base status items and
 * returns the resulting vocabulary. Never touches custom status items — the
 * legacy field only ever named the seven base statuses.
 */
export async function setDisabledStatuses(
  supabase: SupabaseServerClient,
  userId: string,
  disabledStatuses: string[],
): Promise<ServiceResponse<VocabularyItem[]>> {
  if (disabledStatuses.includes("draft")) {
    return err("INVALID_INPUT", "draft cannot be disabled")
  }

  const seedError = await ensureBaseItemsMaterialized(supabase, userId)
  if (seedError) return { data: null, error: seedError }

  if (disabledStatuses.length > 0) {
    const { error } = await supabase
      .from("vocabulary_items")
      .update({ hidden: true, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("kind", "status")
      .in("key", disabledStatuses)
    if (error) return err("DB_ERROR", error.message, true)
  }

  let clearQuery = supabase
    .from("vocabulary_items")
    .update({ hidden: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("kind", "status")
    .eq("is_base", true)

  clearQuery =
    disabledStatuses.length > 0
      ? clearQuery.not("key", "in", `(${disabledStatuses.join(",")})`)
      : clearQuery

  const { error: clearError } = await clearQuery
  if (clearError) return err("DB_ERROR", clearError.message, true)

  return listVocabulary(supabase, userId)
}
