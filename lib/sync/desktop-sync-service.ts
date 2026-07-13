"use client"

import type {
  FlushSyncResult,
  HydrateCollectionsResult,
  HydrateWritingInput,
  HydrateWritingResult,
  HydrateWritingsResult,
  QuerySyncStatusInput,
  SyncRuntimeState,
  SyncService,
  SyncStatus,
} from "@/lib/services/contracts/sync-service"
import type { LocalCollection, SyncMutation } from "@/lib/local-db/schema"
import { scheduleDesktopCatalogMutationStatus } from "@/lib/sync/catalog-dual-write"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"
import { getLocalDBScope, localDB } from "@/lib/local-db"
import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { desktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import { computeMarkdownContentHash } from "@/lib/content-hash"
import { tauriOpenFile } from "@/lib/services/desktop/tauri-commands"
import { filenameToTitle } from "@/lib/desktop/document-naming"
import { normalizeArtifactType } from "@/lib/writings/artifact-type"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import type { CloudDocumentSnapshot } from "@/lib/services/contracts/document-catalog"
import {
  beginHydrationProgress,
  completeHydrationProgress,
  failHydrationProgress,
  hasHydratedUserOnDevice,
  markHydratedUserOnDevice,
  resetHydrationProgress,
  updateHydrationProgress,
} from "@/lib/sync/hydration-progress"
import { emitSyncStatusChange } from "@/lib/sync/events"
import { canRetryMutation, getNextRetryAt } from "@/lib/sync/retry"
import {
  applyRemoteSoftDelete,
  mapRemoteWritingToLocal,
  mergeRemoteWriting,
  needsBodyFetch,
  shouldApplyRemoteWriting,
  type RemoteWritingListRecord,
  type RemoteWritingRecord,
} from "@/lib/sync/remote-bootstrap"

type RemoteCollectionRecord = {
  id: string
  owner_id: string
  name: string | null
  description: string | null
  visibility: "private" | "public" | null
  created_at: string
  updated_at: string
}

type RemoteWritingCollectionRecord = {
  collection_id: string
  writing_id: string
  added_at: string | null
}

const MANIFEST_SELECT = "id, updated_at, content_hash, deleted_at, version"
// Cap for phase-2 .in(...) batches: keeps the request URL bounded (PostgREST
// receives ids in the query string) and mirrors the /api/writings batch limit.
const BODY_FETCH_BATCH_SIZE = 200
const WRITING_SELECT =
  "id, author_id, title, slug, status, artifact_type, visibility, parent_id, correspondence_id, version, deleted_at, created_at, updated_at, content_hash, body_json, body_text"
const COLLECTION_SELECT = "id, owner_id, name, description, visibility, created_at, updated_at"
const DESKTOP_FLUSH_DEBOUNCE_MS = 1500
// Freshness window for sequential hydration callers. Desk and Collections mount
// after bootstrap has already hydrated, so a single-flight guard alone would
// still let them fire a second request. Calls inside this window reuse the
// local state without a network round-trip. Value chosen within the 30–60 s
// range suggested by the sync improvement plan.
const HYDRATION_FRESHNESS_WINDOW_MS = 45_000

let scheduledFlushId: number | null = null
let desktopSyncStarted = false
let lastSyncedAt: string | null = null
let desktopCatalogPromise: Promise<SqliteDocumentCatalog> | null = null

async function getDesktopCatalog() {
  if (!desktopCatalogPromise) {
    desktopCatalogPromise = (async () => {
      const { appConfigDir, join } = await import("@tauri-apps/api/path")
      return new SqliteDocumentCatalog(
        await join(await appConfigDir(), "desktop-index.sqlite3"),
      )
    })()
  }
  return desktopCatalogPromise
}

type InFlightHydration<T> = {
  userId: string
  promise: Promise<ServiceResponse<T>>
}

let inFlightWritingsHydration: InFlightHydration<HydrateWritingsResult> | null = null
const lastWritingsHydrationByUserId = new Map<string, number>()

let inFlightCollectionsHydration: InFlightHydration<HydrateCollectionsResult> | null = null
const lastCollectionsHydrationByUserId = new Map<string, number>()

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(message: string): ServiceResponse<T> {
  return { data: null, error: { code: "UNAVAILABLE", message, retryable: true } }
}

function logDesktopSyncError(message: string, detail?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test") {
    return
  }

  console.error("[desktop-sync]", detail ? { message, ...detail } : message)
}

function logDesktopSyncInfo(message: string, detail?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test") {
    return
  }

  console.info("[desktop-sync]", detail ? { message, ...detail } : message)
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function normalizeCollectionVisibility(
  value: RemoteCollectionRecord["visibility"],
): LocalCollection["visibility"] {
  return value === "public" ? "public" : "private"
}

function toLocalCollection(remote: RemoteCollectionRecord): LocalCollection {
  const updatedAtMs = parseTimestamp(remote.updated_at)

  return {
    id: remote.id,
    owner_id: remote.owner_id,
    name: remote.name?.trim() || "Untitled collection",
    description: remote.description ?? null,
    visibility: normalizeCollectionVisibility(remote.visibility),
    sync_status: "synced",
    lifecycle: "server-confirmed",
    deleted_at: null,
    created_at: remote.created_at,
    updated_at: remote.updated_at,
    local_updated_at: updatedAtMs || Date.now(),
  }
}

async function getAuthenticatedUserId() {
  // Read the session LOCALLY (same source the desktop app shell trusts at
  // startup) instead of getAuthService().getSession(), which on desktop calls
  // supabase.auth.getUser() — a network round-trip that returns null silently
  // when offline or when the token can't be validated, gating sync off without
  // any visible signal. getSession() resolves from Keychain/store in memory.
  try {
    const supabase = createDesktopClient()
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      logDesktopSyncError("getSession failed while resolving desktop user.", {
        error: error.message,
      })
      return null
    }
    return data.session?.user?.id ?? null
  } catch (error) {
    logDesktopSyncError("getSession threw while resolving desktop user.", {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine
}

function isExpectedScopeStillActive(expectedUserId: string): boolean {
  return getLocalDBScope() === expectedUserId
}

/**
 * Clear the freshness window so the next hydrate call hits the network.
 * Used by explicit refresh flows (e.g. window focus / online) that must bypass
 * the freshness window. Passing a userId limits invalidation to that user;
 * omitting it clears all users.
 */
export function invalidateHydrationFreshness(userId?: string): void {
  if (userId) {
    lastWritingsHydrationByUserId.delete(userId)
    lastCollectionsHydrationByUserId.delete(userId)
  } else {
    lastWritingsHydrationByUserId.clear()
    lastCollectionsHydrationByUserId.clear()
  }
}

function clearInFlightWritingsHydration(userId: string) {
  if (inFlightWritingsHydration?.userId === userId) {
    inFlightWritingsHydration = null
  }
}

function clearInFlightCollectionsHydration(userId: string) {
  if (inFlightCollectionsHydration?.userId === userId) {
    inFlightCollectionsHydration = null
  }
}

function clearScheduledFlush() {
  if (scheduledFlushId !== null && typeof window !== "undefined") {
    window.clearTimeout(scheduledFlushId)
    scheduledFlushId = null
  }
}

function scheduleDesktopFlush(delay = DESKTOP_FLUSH_DEBOUNCE_MS) {
  if (typeof window === "undefined") {
    return
  }

  clearScheduledFlush()
  scheduledFlushId = window.setTimeout(() => {
    scheduledFlushId = null
    void desktopSyncService.flushPending()
  }, delay)
}

async function hydrateCollectionsForUser(userId: string): Promise<number> {
  const supabase = createDesktopClient()
  const [collectionsResult, writingCollectionsResult] = await Promise.all([
    supabase
      .from("collections")
      .select(COLLECTION_SELECT)
      .eq("owner_id", userId),
    supabase
      .from("writing_collections")
      .select("collection_id, writing_id, added_at"),
  ])

  if (collectionsResult.error) {
    throw new Error(collectionsResult.error.message)
  }

  if (writingCollectionsResult.error) {
    throw new Error(writingCollectionsResult.error.message)
  }

  let appliedCount = 0

  for (const collection of (collectionsResult.data ?? []) as RemoteCollectionRecord[]) {
    if (!isExpectedScopeStillActive(userId)) {
      logDesktopSyncInfo("hydrateCollections aborted: scope changed during hydration", {
        expectedUserId: userId,
        currentScope: getLocalDBScope(),
      })
      return appliedCount
    }

    const localCollection = await localDB.collections.get(collection.id)
    const hasPendingMutation = await localDB.syncQueue.getCurrentForEntity("collection", collection.id)

    if (
      localCollection &&
      (localCollection.sync_status === "pending" ||
        localCollection.sync_status === "failed" ||
        hasPendingMutation ||
        localCollection.local_updated_at > parseTimestamp(collection.updated_at))
    ) {
      continue
    }

    await localDB.collections.save(toLocalCollection(collection))
    appliedCount += 1
  }

  const assignments = (writingCollectionsResult.data ?? []) as RemoteWritingCollectionRecord[]
  const writingIds = Array.from(new Set(assignments.map((assignment) => assignment.writing_id)))
  const assignmentsByWriting = new Map<string, string[]>()

  for (const writingId of writingIds) {
    assignmentsByWriting.set(writingId, [])
  }

  for (const assignment of assignments) {
    assignmentsByWriting.get(assignment.writing_id)?.push(assignment.collection_id)
  }

  for (const writingId of writingIds) {
    if (!isExpectedScopeStillActive(userId)) {
      logDesktopSyncInfo("hydrateCollections aborted: scope changed during hydration", {
        expectedUserId: userId,
        currentScope: getLocalDBScope(),
      })
      return appliedCount
    }

    const pendingMutation = await localDB.syncQueue.getCurrentForEntity("writing-collections", writingId)
    if (pendingMutation) {
      continue
    }

    await localDB.writingCollections.replaceForWriting(
      writingId,
      assignmentsByWriting.get(writingId) ?? [],
    )
  }

  return appliedCount
}

async function processWritingMutation(userId: string, mutation: Extract<SyncMutation, { entity_kind: "writing" }>) {
  const supabase = createDesktopClient()

  if (mutation.operation === "delete") {
    const { error } = await supabase
      .from("writings")
      .update({
        deleted_at: mutation.payload.deleted_at,
        updated_at: mutation.payload.updated_at,
        version: mutation.payload.version,
      })
      .eq("id", mutation.entity_id)
      .eq("author_id", userId)

    if (error) {
      throw new Error(error.message)
    }

    return
  }

  const existing = await localDB.writings.get(mutation.entity_id)
  let canonicalPayload = mutation.payload

  if (existing?.canonical_path) {
    try {
      const source = await tauriOpenFile(existing.canonical_path)
      const parsed = desktopDocumentEngine.parseSourceDocument(source)

      if (parsed.success) {
        canonicalPayload = {
          ...canonicalPayload,
          title: filenameToTitle(existing.canonical_path),
          body_json: parsed.document.snapshot.bodyJson as Record<string, unknown>,
          body_text: parsed.document.snapshot.bodyText,
          content_hash: await computeMarkdownContentHash(source),
        }
      }
    } catch (error) {
      logDesktopSyncError("failed to read canonical desktop file before cloud push", {
        canonicalPath: existing.canonical_path,
        writingId: mutation.entity_id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const row = {
    // Spread payload FIRST, then pin id/author_id. The locally-created writing
    // carries author_id: null, so spreading payload last would overwrite it.
    ...canonicalPayload,
    id: mutation.entity_id,
    author_id: userId,
  }

  const runUpdate = async () => {
    const { error } = await supabase
      .from("writings")
      .update(row)
      .eq("id", mutation.entity_id)
      .eq("author_id", userId)
    if (error) {
      throw new Error(error.message)
    }
  }

  // IMPORTANT: do NOT use PostgREST upsert (on_conflict) or return=representation
  // on writes here. On this project both trip a 42501 "new row violates
  // row-level security policy" even though the row satisfies the policy — the
  // writings WITH CHECK self-references the table, and Postgres evaluates it
  // differently under ON CONFLICT / RETURNING. Empirically only a plain INSERT
  // with return=minimal passes (UPDATE works either way). Neither call uses
  // .select(), so both stay return=minimal.
  //
  // Pick INSERT vs UPDATE by the local lifecycle so the happy path makes one
  // call and never logs a noisy 409: rows already on the server → UPDATE; new
  // local-only rows → INSERT. Fall back the other way only on a real mismatch.
  if (existing?.lifecycle === "server-confirmed") {
    await runUpdate()
  } else {
    const { error } = await supabase.from("writings").insert(row)
    if (error) {
      if (error.code === "23505") {
        await runUpdate()
      } else {
        throw new Error(error.message)
      }
    }
  }

  // return=minimal gives no row back, so reflect the server-confirmed state
  // locally without re-mapping a remote record. Any server-derived fields
  // (e.g. slug on publish) reconcile on the next hydrate.
  if (existing) {
    await localDB.writings.save({
      ...existing,
      title: canonicalPayload.title,
      sync_status: "synced",
      lifecycle: "server-confirmed",
    })
  }
}

async function processCollectionMutation(
  userId: string,
  mutation: Extract<SyncMutation, { entity_kind: "collection" }>,
) {
  const supabase = createDesktopClient()

  if (mutation.operation === "delete") {
    const { error } = await supabase.from("collections").delete().eq("id", mutation.entity_id).eq("owner_id", userId)

    if (error) {
      throw new Error(error.message)
    }

    return
  }

  const row = {
    ...mutation.payload,
    id: mutation.entity_id,
    owner_id: userId,
  }

  // Same approach as writings: avoid PostgREST upsert (on_conflict) under RLS.
  // Plain insert, falling back to update on a primary-key conflict.
  const insertResult = await supabase.from("collections").insert(row)

  if (insertResult.error) {
    if (insertResult.error.code === "23505") {
      const updateResult = await supabase
        .from("collections")
        .update(row)
        .eq("id", mutation.entity_id)
        .eq("owner_id", userId)

      if (updateResult.error) {
        throw new Error(updateResult.error.message)
      }
    } else {
      throw new Error(insertResult.error.message)
    }
  }
}

async function processWritingCollectionsMutation(
  mutation: Extract<SyncMutation, { entity_kind: "writing-collections" }>,
) {
  const supabase = createDesktopClient()
  const { error: deleteError } = await supabase
    .from("writing_collections")
    .delete()
    .eq("writing_id", mutation.entity_id)

  if (deleteError) {
    throw new Error(deleteError.message)
  }

  if (mutation.payload.collection_ids.length === 0) {
    return
  }

  const rows = mutation.payload.collection_ids.map((collectionId) => ({
    writing_id: mutation.entity_id,
    collection_id: collectionId,
    added_at: mutation.payload.updated_at,
  }))

  const { error: insertError } = await supabase.from("writing_collections").insert(rows)

  if (insertError) {
    throw new Error(insertError.message)
  }
}

async function processPendingMutation(userId: string, mutation: SyncMutation) {
  try {
    if (mutation.entity_kind === "writing") {
      emitSyncStatusChange({
        writingId: mutation.entity_id,
        status: "syncing",
      })
    }

    if (mutation.entity_kind === "writing") {
      await processWritingMutation(userId, mutation)
    } else if (mutation.entity_kind === "collection") {
      await processCollectionMutation(userId, mutation)
    } else {
      await processWritingCollectionsMutation(mutation)
    }

    await localDB.syncQueue.markSynced(mutation.id)
    if (mutation.entity_kind === "writing") scheduleDesktopCatalogMutationStatus(mutation, "synced")
    lastSyncedAt = new Date().toISOString()

    if (mutation.entity_kind === "writing") {
      emitSyncStatusChange({
        writingId: mutation.entity_id,
        status: "synced",
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop sync failed"

    logDesktopSyncError(message, {
      entityKind: mutation.entity_kind,
      entityId: mutation.entity_id,
      operation: mutation.operation,
      attempts: mutation.attempts + 1,
    })

    if (mutation.entity_kind === "writing") {
      emitSyncStatusChange({
        writingId: mutation.entity_id,
        status: "retrying",
      })
    }

    if (!canRetryMutation(mutation.attempts + 1)) {
      await localDB.syncQueue.markFailed(mutation.id, message, Number.MAX_SAFE_INTEGER)
      if (mutation.entity_kind === "writing") scheduleDesktopCatalogMutationStatus(mutation, "failed", Number.MAX_SAFE_INTEGER, message)
      return
    }

    const nextRetryAt = getNextRetryAt(mutation.attempts + 1)
    await localDB.syncQueue.markFailed(mutation.id, message, nextRetryAt)
    if (mutation.entity_kind === "writing") scheduleDesktopCatalogMutationStatus(mutation, "failed", nextRetryAt, message)
    scheduleDesktopFlush()
  }
}

async function buildRuntimeState(input?: QuerySyncStatusInput): Promise<SyncRuntimeState> {
  const pendingMutations = await localDB.syncQueue.getPending()
  const relevantMutations = input?.writingId
    ? pendingMutations.filter(
        (mutation) => mutation.entity_kind === "writing" && mutation.entity_id === input.writingId,
      )
    : pendingMutations

  let status: SyncStatus = "idle"

  if (relevantMutations.length > 0) {
    if (!isOnline()) {
      status = "offline"
    } else if (relevantMutations.some((mutation) => mutation.attempts > 0)) {
      status = "failed"
    } else {
      status = "pending"
    }
  } else if (lastSyncedAt) {
    status = "synced"
  }

  const retryTimes = relevantMutations
    .map((mutation) => mutation.next_retry_at ?? Number.MAX_SAFE_INTEGER)
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp !== Number.MAX_SAFE_INTEGER)

  return {
    status,
    pendingMutations: relevantMutations.length,
    nextRetryAt: retryTimes.length > 0 ? Math.min(...retryTimes) : null,
    lastSyncedAt,
  }
}

async function doHydrateWritingsForUser(userId: string): Promise<ServiceResponse<HydrateWritingsResult>> {
  const shouldShowProgress = !hasHydratedUserOnDevice(userId)

  try {
    const supabase = createDesktopClient()

    // Phase 1: manifest — fetch only the metadata needed to decide what changed.
    const { data: manifestData, error: manifestError } = await supabase
      .from("writings")
      .select(MANIFEST_SELECT)
      .eq("author_id", userId)
      .order("updated_at", { ascending: false })

    if (manifestError) {
      throw new Error(manifestError.message)
    }

    const manifest = (manifestData ?? []) as RemoteWritingListRecord[]

    const changedIds: string[] = []
    const deleteEntries: RemoteWritingListRecord[] = []

    for (const remoteWriting of manifest) {
      // Race: sign-out or user switch during hydration. Discard writes for a
      // scope that is no longer active to avoid leaking one user's data into
      // another (T-E / failure mode: sign-out during in-flight hydration).
      if (!isExpectedScopeStillActive(userId)) {
        logDesktopSyncInfo("hydrateWritings aborted: scope changed during hydration", {
          expectedUserId: userId,
          currentScope: getLocalDBScope(),
        })
        if (shouldShowProgress) {
          failHydrationProgress("User changed during hydration")
        }
        return ok({ appliedCount: 0, hydratedIds: [] })
      }

      const localWriting = await localDB.writings.get(remoteWriting.id)

      if (remoteWriting.deleted_at) {
        if (localWriting && shouldApplyRemoteWriting(localWriting, remoteWriting)) {
          deleteEntries.push(remoteWriting)
        }
        continue
      }

      if (needsBodyFetch(localWriting, remoteWriting)) {
        changedIds.push(remoteWriting.id)
      }
    }

    const totalWorkItems = changedIds.length + deleteEntries.length

    if (shouldShowProgress) {
      beginHydrationProgress(userId, totalWorkItems)
    }

    // Phase 2: fetch full bodies only for writings that actually changed.
    // On a clean machine (first startup) changedIds equals the manifest length,
    // so we fetch the full list in a single request instead of building a huge
    // .in(...) URL. Partial subsets are chunked so the .in(...) URL stays
    // bounded regardless of how many writings changed.
    let remoteBodies: RemoteWritingRecord[] = []
    if (changedIds.length > 0) {
      const allChanged = changedIds.length === manifest.length

      if (allChanged) {
        const { data: bodiesData, error: bodiesError } = await supabase
          .from("writings")
          .select(WRITING_SELECT)
          .eq("author_id", userId)
          .order("updated_at", { ascending: false })

        if (bodiesError) {
          throw new Error(bodiesError.message)
        }

        remoteBodies = (bodiesData ?? []) as RemoteWritingRecord[]
      } else {
        for (let start = 0; start < changedIds.length; start += BODY_FETCH_BATCH_SIZE) {
          const chunk = changedIds.slice(start, start + BODY_FETCH_BATCH_SIZE)
          const { data: bodiesData, error: bodiesError } = await supabase
            .from("writings")
            .select(WRITING_SELECT)
            .eq("author_id", userId)
            .in("id", chunk)

          if (bodiesError) {
            throw new Error(bodiesError.message)
          }

          remoteBodies.push(...((bodiesData ?? []) as RemoteWritingRecord[]))
        }
      }
    }

    let appliedCount = 0
    const hydratedIds: string[] = []

    // Apply remote deletes first — they need no body and the manifest already
    // carries enough information (deleted_at + version + updated_at).
    for (const deleteEntry of deleteEntries) {
      if (!isExpectedScopeStillActive(userId)) {
        logDesktopSyncInfo("hydrateWritings aborted: scope changed during hydration", {
          expectedUserId: userId,
          currentScope: getLocalDBScope(),
        })
        if (shouldShowProgress) {
          failHydrationProgress("User changed during hydration")
        }
        return ok({ appliedCount, hydratedIds })
      }

      const localWriting = await localDB.writings.get(deleteEntry.id)
      if (!localWriting) {
        continue
      }

      if (await applyRemoteSoftDelete(localWriting, deleteEntry)) {
        appliedCount += 1
        hydratedIds.push(deleteEntry.id)
      }

      if (shouldShowProgress) {
        updateHydrationProgress(hydratedIds.length, totalWorkItems)
      }
    }

    const requestedIds = new Set(changedIds)

    for (let index = 0; index < remoteBodies.length; index += 1) {
      const remoteWriting = remoteBodies[index]

      if (!requestedIds.has(remoteWriting.id)) {
        // Defensive: the server returned an id we did not request (deleted
        // between phases or RLS change). Log and skip; do not collapse the
        // batch.
        logDesktopSyncInfo("hydrateWritings: phase-2 response returned an id that was not requested", {
          writingId: remoteWriting.id,
        })
        continue
      }

      requestedIds.delete(remoteWriting.id)

      if (!isExpectedScopeStillActive(userId)) {
        logDesktopSyncInfo("hydrateWritings aborted: scope changed during hydration", {
          expectedUserId: userId,
          currentScope: getLocalDBScope(),
        })
        if (shouldShowProgress) {
          failHydrationProgress("User changed during hydration")
        }
        return ok({ appliedCount, hydratedIds })
      }

      if (await mergeRemoteWriting(remoteWriting)) {
        appliedCount += 1
        hydratedIds.push(remoteWriting.id)
      }

      if (
        shouldShowProgress &&
        (index === remoteBodies.length - 1 || (deleteEntries.length + index + 1) % 10 === 0)
      ) {
        updateHydrationProgress(deleteEntries.length + index + 1, totalWorkItems)
      }
    }

    for (const missingId of requestedIds) {
      logDesktopSyncInfo("hydrateWritings: phase-2 response missing requested id", {
        writingId: missingId,
      })
    }

    // Metadata hydration projects one atomic cloud burst into SQLite. This
    // never writes a file and the Rust command preserves local_present/binding
    // for rows already materialized (ODE-371, reactive fan-out = one signal).
    if (!isExpectedScopeStillActive(userId)) {
      return ok({ appliedCount, hydratedIds })
    }
    const cloudSnapshots: CloudDocumentSnapshot[] = []
    for (const remoteWriting of manifest) {
      const localWriting = await localDB.writings.get(remoteWriting.id)
      if (!localWriting) continue
      cloudSnapshots.push({
        id: remoteWriting.id,
        cloudPresent: !remoteWriting.deleted_at,
        cloudAccountId: userId,
        contentHash: remoteWriting.content_hash ?? null,
        syncStatus: localWriting.sync_status === "pending" || localWriting.sync_status === "failed"
          ? localWriting.sync_status
          : remoteWriting.deleted_at && localWriting.canonical_path
            ? "local-only" as const
            : remoteWriting.deleted_at
              ? "deleted" as const
              : "synced" as const,
        title: localWriting.title ?? null,
        slug: localWriting.slug ?? null,
        status: localWriting.status,
        artifactType: normalizeArtifactType(localWriting.artifact_type),
        visibility: localWriting.visibility,
        version: remoteWriting.version,
        createdAt: parseTimestamp(localWriting.created_at) || null,
        modifiedAt: parseTimestamp(remoteWriting.updated_at) || null,
      })
    }
    await (await getDesktopCatalog()).applyCloudSnapshots(cloudSnapshots)

    if (shouldShowProgress) {
      markHydratedUserOnDevice(userId)
      completeHydrationProgress()
    }

    return ok({ appliedCount, hydratedIds })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop hydration failed"
    if (shouldShowProgress) {
      failHydrationProgress(message)
    }
    return err(message)
  }
}

async function doHydrateCollectionsForUser(userId: string): Promise<ServiceResponse<HydrateCollectionsResult>> {
  try {
    const appliedCount = await hydrateCollectionsForUser(userId)
    return ok({ appliedCount })
  } catch (error) {
    return err(error instanceof Error ? error.message : "Desktop collection hydration failed")
  }
}

export const desktopSyncService: SyncService = {
  async enqueueMutation(input) {
    const { webSyncService } = await import("@/lib/services/web-sync-service")
    return webSyncService.enqueueMutation(input)
  },

  async hydrateWritings(): Promise<ServiceResponse<HydrateWritingsResult>> {
    const userId = await getAuthenticatedUserId()

    if (!userId) {
      resetHydrationProgress()
      return ok({ appliedCount: 0, hydratedIds: [] })
    }

    // Freshness window: sequential callers (e.g. Desk mounting after bootstrap)
    // reuse the local state without issuing another request.
    const lastHydratedAt = lastWritingsHydrationByUserId.get(userId)
    if (lastHydratedAt && Date.now() - lastHydratedAt < HYDRATION_FRESHNESS_WINDOW_MS) {
      return ok({ appliedCount: 0, hydratedIds: [] })
    }

    // Single-flight: concurrent callers share the same in-flight promise.
    if (inFlightWritingsHydration?.userId === userId) {
      return inFlightWritingsHydration.promise
    }

    const promise = doHydrateWritingsForUser(userId).finally(() => {
      clearInFlightWritingsHydration(userId)
    })

    inFlightWritingsHydration = { userId, promise }
    const result = await promise

    // Only treat the hydration as fresh on a successful result. A network or
    // scope-change failure must not mark the window, so the next attempt can
    // retry.
    if (!result.error) {
      lastWritingsHydrationByUserId.set(userId, Date.now())
    }

    return result
  },

  async hydrateWriting(
    input: HydrateWritingInput,
  ): Promise<ServiceResponse<HydrateWritingResult>> {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return ok({ hydrated: false, writingId: input.writingId })
    }

    try {
      const supabase = createDesktopClient()
      const { data, error } = await supabase
        .from("writings")
        .select(WRITING_SELECT)
        .eq("id", input.writingId)
        .eq("author_id", userId)
        .single()

      if (error) {
        throw new Error(error.message)
      }

      const remoteWriting = data as RemoteWritingRecord
      const localWriting = await localDB.writings.get(remoteWriting.id)
      const hydrated = shouldApplyRemoteWriting(localWriting, remoteWriting)

      if (hydrated) {
        await localDB.writings.save(mapRemoteWritingToLocal(remoteWriting, localWriting))
      }

      const projected = await localDB.writings.get(remoteWriting.id)
      if (projected) {
        await (await getDesktopCatalog()).applyCloudSnapshot({
          id: remoteWriting.id,
          cloudPresent: !remoteWriting.deleted_at,
          cloudAccountId: userId,
          contentHash: remoteWriting.content_hash ?? null,
          syncStatus: projected.sync_status === "pending" || projected.sync_status === "failed"
            ? projected.sync_status
            : remoteWriting.deleted_at && projected.canonical_path
              ? "local-only"
              : remoteWriting.deleted_at ? "deleted" : "synced",
          title: projected.title ?? null,
          slug: projected.slug ?? null,
          status: projected.status,
          artifactType: normalizeArtifactType(projected.artifact_type),
          visibility: projected.visibility,
          version: remoteWriting.version,
          createdAt: parseTimestamp(projected.created_at) || null,
          modifiedAt: parseTimestamp(remoteWriting.updated_at) || null,
        })
      }

      return ok({ hydrated, writingId: input.writingId })
    } catch (error) {
      return err(error instanceof Error ? error.message : "Desktop writing hydration failed")
    }
  },

  async hydrateCollections(): Promise<ServiceResponse<HydrateCollectionsResult>> {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return ok({ appliedCount: 0 })
    }

    const lastHydratedAt = lastCollectionsHydrationByUserId.get(userId)
    if (lastHydratedAt && Date.now() - lastHydratedAt < HYDRATION_FRESHNESS_WINDOW_MS) {
      return ok({ appliedCount: 0 })
    }

    if (inFlightCollectionsHydration?.userId === userId) {
      return inFlightCollectionsHydration.promise
    }

    const promise = doHydrateCollectionsForUser(userId).finally(() => {
      clearInFlightCollectionsHydration(userId)
    })

    inFlightCollectionsHydration = { userId, promise }
    const result = await promise

    if (!result.error) {
      lastCollectionsHydrationByUserId.set(userId, Date.now())
    }

    return result
  },

  async flushPending() {
    const userId = await getAuthenticatedUserId()
    const pendingBefore = await localDB.syncQueue.getPending()

    logDesktopSyncInfo("flushPending invoked.", {
      hasUser: Boolean(userId),
      pendingMutations: pendingBefore.length,
      online: isOnline(),
    })

    if (!userId) {
      if (pendingBefore.length > 0) {
        logDesktopSyncError("Cannot flush pending mutations without an authenticated desktop session.", {
          pendingMutations: pendingBefore.length,
        })
      }

      return ok({ processedMutations: 0, failedMutations: [], nextRetryAt: null })
    }

    if (!isOnline()) {
      pendingBefore.forEach((mutation) => {
        if (mutation.entity_kind === "writing") {
          emitSyncStatusChange({
            writingId: mutation.entity_id,
            status: "offline",
          })
        }
      })

      return ok({ processedMutations: 0, failedMutations: [], nextRetryAt: null })
    }

    for (const mutation of pendingBefore) {
      await processPendingMutation(userId, mutation)
    }

    const pendingAfter = await localDB.syncQueue.getPending()
    const failedMutations = pendingAfter.filter((mutation) => mutation.attempts > 0).map((mutation) => mutation.id)
    const nextRetryAt = pendingAfter
      .map((mutation) => mutation.next_retry_at ?? Number.MAX_SAFE_INTEGER)
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp !== Number.MAX_SAFE_INTEGER)

    const result: FlushSyncResult = {
      processedMutations: Math.max(0, pendingBefore.length - pendingAfter.length),
      failedMutations,
      nextRetryAt: nextRetryAt.length > 0 ? Math.min(...nextRetryAt) : null,
    }

    return ok(result)
  },

  async scheduleFlush() {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      logDesktopSyncInfo("scheduleFlush skipped: no desktop session at schedule time.")
      return ok(undefined)
    }

    scheduleDesktopFlush()
    return ok(undefined)
  },

  async start() {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return ok(undefined)
    }

    if (typeof window === "undefined" || desktopSyncStarted) {
      return ok(undefined)
    }

    desktopSyncStarted = true
    window.addEventListener("online", handleDesktopOnline)
    scheduleDesktopFlush(0)
    return ok(undefined)
  },

  async stop() {
    if (typeof window !== "undefined" && desktopSyncStarted) {
      desktopSyncStarted = false
      window.removeEventListener("online", handleDesktopOnline)
    }

    clearScheduledFlush()
    return ok(undefined)
  },

  async getRuntimeState(input?: QuerySyncStatusInput): Promise<ServiceResponse<SyncRuntimeState>> {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return ok({
        status: "idle",
        pendingMutations: 0,
        nextRetryAt: null,
        lastSyncedAt: null,
      })
    }

    return ok(await buildRuntimeState(input))
  },
}

const handleDesktopOnline = () => {
  scheduleDesktopFlush(0)
}
