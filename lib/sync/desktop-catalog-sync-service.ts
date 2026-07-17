"use client"

import type {
  EnqueueSyncMutationInput,
  FlushSyncResult,
  HydrateWritingResult,
  HydrateWritingsResult,
  SyncRuntimeState,
  SyncService,
} from "@/lib/services/contracts/sync-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { desktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import { filenameToTitle } from "@/lib/desktop/document-naming"
import {
  tauriCatalogApplyCollectionSnapshot,
  tauriCatalogEnqueueMutation,
  tauriCatalogListPendingMetadataMutations,
  tauriCatalogListPendingMutations,
  tauriCatalogUpdateMetadataMutationStatus,
  tauriCatalogUpdateMutationStatus,
  tauriOpenFile,
} from "@/lib/services/desktop/tauri-commands"

function ok<T>(data: T): ServiceResponse<T> { return { data, error: null } }
function fail<T>(code: ServiceError["code"], message: string): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable: code === "UNAVAILABLE" } }
}

let catalogPromise: Promise<SqliteDocumentCatalog> | null = null
async function catalog() {
  catalogPromise ??= (async () => {
    const { appConfigDir, join } = await import("@tauri-apps/api/path")
    return new SqliteDocumentCatalog(await join(await appConfigDir(), "desktop-index.sqlite3"))
  })()
  return catalogPromise
}

let started = false
let scheduled: ReturnType<typeof setTimeout> | null = null
let lastSyncedAt: string | null = null

async function sessionUserId() {
  const { data, error } = await createDesktopClient().auth.getSession()
  if (error) throw new Error(error.message)
  return data.session?.user.id ?? null
}

function payloadValue(payload: Record<string, unknown>, camel: string, snake: string) {
  return payload[camel] ?? payload[snake] ?? null
}

async function hydrateOne(id: string): Promise<boolean> {
  const userId = await sessionUserId()
  if (!userId) return false
  const { data, error } = await createDesktopClient()
    .from("writings")
    .select("id,author_id,title,slug,status,artifact_type,visibility,version,created_at,updated_at,content_hash,deleted_at")
    .eq("id", id)
    .eq("author_id", userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return false
  await (await catalog()).applyCloudSnapshot({
    id: data.id, localPresent: false, cloudPresent: !data.deleted_at,
    cloudAccountId: data.author_id, syncStatus: data.deleted_at ? "deleted" : "synced",
    contentHash: data.content_hash, title: data.title, slug: data.slug,
    status: data.status, artifactType: data.artifact_type, visibility: data.visibility,
    version: data.version, createdAt: Date.parse(data.created_at), modifiedAt: Date.parse(data.updated_at),
  })
  return true
}

async function processMutation(
  userId: string,
  mutation: Awaited<ReturnType<typeof tauriCatalogListPendingMutations>>[number],
) {
  const store = await catalog()
  const record = await store.getById(mutation.documentId)
  const payload = JSON.parse(mutation.payloadJson) as Record<string, unknown>
  const updatedAt = String(payloadValue(payload, "updatedAt", "updated_at") ?? new Date().toISOString())
  const version = Number(payload.version ?? 1)
  const supabase = createDesktopClient()

  if (mutation.operation === "delete") {
    const { error } = await supabase.from("writings").update({
      deleted_at: payloadValue(payload, "deletedAt", "deleted_at") ?? updatedAt,
      updated_at: updatedAt,
      version,
    }).eq("id", mutation.documentId).eq("author_id", userId)
    if (error) throw new Error(error.message)
    return
  }

  let bodyJson = payloadValue(payload, "bodyJson", "body_json")
  let bodyText = String(payloadValue(payload, "bodyText", "body_text") ?? "")
  let title = payload.title ?? record?.title ?? null
  if (record?.binding?.canonicalPath) {
    const markdown = await tauriOpenFile(record.binding.canonicalPath)
    const parsed = desktopDocumentEngine.parseSourceDocument(markdown)
    if (!parsed.success) throw new Error(parsed.error)
    bodyJson = parsed.document.snapshot.bodyJson
    bodyText = parsed.document.snapshot.bodyText
    title = filenameToTitle(record.binding.relativePath)
  }
  const row = {
    id: mutation.documentId,
    author_id: userId,
    title,
    body_json: bodyJson,
    body_text: bodyText,
    slug: payload.slug ?? null,
    status: payload.status ?? "draft",
    artifact_type: payloadValue(payload, "artifactType", "artifact_type") ?? "general",
    visibility: payload.visibility ?? "private",
    parent_id: payloadValue(payload, "parentId", "parent_id"),
    correspondence_id: payloadValue(payload, "correspondenceId", "correspondence_id"),
    version,
    updated_at: updatedAt,
    deleted_at: payloadValue(payload, "deletedAt", "deleted_at"),
  }
  const write = record?.cloudPresent
    ? supabase.from("writings").update(row).eq("id", mutation.documentId).eq("author_id", userId)
    : supabase.from("writings").insert(row)
  const { error } = await write
  if (error) throw new Error(error.message)
}

async function processMetadataMutation(
  userId: string,
  mutation: Awaited<ReturnType<typeof tauriCatalogListPendingMetadataMutations>>[number],
) {
  const payload = JSON.parse(mutation.payloadJson) as Record<string, unknown>
  const supabase = createDesktopClient()
  if (mutation.entityKind === "collection") {
    if (mutation.operation === "delete") {
      const { error } = await supabase.from("collections").delete().eq("id", mutation.entityId).eq("owner_id", userId)
      if (error) throw new Error(error.message)
      return
    }
    const row = {
      id: mutation.entityId, owner_id: userId, name: payload.name,
      description: payload.description ?? null, visibility: payload.visibility ?? "private",
      updated_at: payloadValue(payload, "updatedAt", "updated_at"),
    }
    const { error } = await supabase.from("collections").upsert(row)
    if (error) throw new Error(error.message)
    return
  }
  const { error: deleteError } = await supabase.from("writing_collections").delete().eq("writing_id", mutation.entityId)
  if (deleteError) throw new Error(deleteError.message)
  const collectionIds = Array.isArray(payload.collection_ids) ? payload.collection_ids.map(String) : []
  if (collectionIds.length > 0) {
    const { error } = await supabase.from("writing_collections").insert(
      collectionIds.map((collectionId) => ({ writing_id: mutation.entityId, collection_id: collectionId })),
    )
    if (error) throw new Error(error.message)
  }
}

export const desktopCatalogSyncService: SyncService = {
  async enqueueMutation(input: EnqueueSyncMutationInput) {
    if (input.mutation.entityKind !== "writing") {
      return fail("UNSUPPORTED", "Desktop SQLite queue currently accepts writing mutations only")
    }
    const store = await catalog()
    const record = await store.getById(input.mutation.entityId)
    if (!record) return fail("NOT_FOUND", `Document ${input.mutation.entityId} is absent from catalog`)
    await tauriCatalogEnqueueMutation(store.dbPath, record.id, {
      id: input.mutation.id,
      operation: input.mutation.operation,
      payloadJson: JSON.stringify(input.mutation.payload),
      status: "pending", attemptCount: input.mutation.attempts,
      nextRetryAt: null, createdAt: input.mutation.createdAt, lastError: null,
    })
    return ok({ accepted: true, mutationId: input.mutation.id, entityKind: "writing", entityId: record.id })
  },

  async hydrateWritings(): Promise<ServiceResponse<HydrateWritingsResult>> {
    try {
      const userId = await sessionUserId()
      if (!userId) return fail("UNAUTHORIZED", "Sign in to hydrate cloud documents")
      const { data, error } = await createDesktopClient()
        .from("writings")
        .select("id,author_id,title,slug,status,artifact_type,visibility,version,created_at,updated_at,content_hash,deleted_at")
        .eq("author_id", userId)
      if (error) throw new Error(error.message)
      const snapshots = (data ?? []).map((row) => ({
        id: row.id, localPresent: false, cloudPresent: !row.deleted_at,
        cloudAccountId: row.author_id, syncStatus: row.deleted_at ? "deleted" as const : "synced" as const,
        contentHash: row.content_hash, title: row.title, slug: row.slug, status: row.status,
        artifactType: row.artifact_type, visibility: row.visibility, version: row.version,
        createdAt: Date.parse(row.created_at), modifiedAt: Date.parse(row.updated_at),
      }))
      await (await catalog()).applyCloudSnapshots(snapshots)
      return ok({ appliedCount: snapshots.length, hydratedIds: snapshots.map((row) => row.id) })
    } catch (error) { return fail("UNAVAILABLE", error instanceof Error ? error.message : "Hydration failed") }
  },

  async hydrateWriting(input): Promise<ServiceResponse<HydrateWritingResult>> {
    try {
      const hydrated = await hydrateOne(input.writingId)
      return hydrated ? ok({ hydrated: true, writingId: input.writingId }) : fail("NOT_FOUND", "Writing not found")
    } catch (error) { return fail("UNAVAILABLE", error instanceof Error ? error.message : "Hydration failed") }
  },

  async hydrateCollections() {
    try {
      const userId = await sessionUserId()
      if (!userId) return fail("UNAUTHORIZED", "Sign in to hydrate collections")
      const supabase = createDesktopClient()
      const [collectionResult, relationResult] = await Promise.all([
        supabase.from("collections").select("id,owner_id,name,description,visibility,created_at,updated_at").eq("owner_id", userId),
        supabase.from("writing_collections").select("writing_id,collection_id,added_at"),
      ])
      if (collectionResult.error) throw new Error(collectionResult.error.message)
      if (relationResult.error) throw new Error(relationResult.error.message)
      const now = Date.now()
      const collections = (collectionResult.data ?? []).map((row) => ({
        id: row.id, ownerId: row.owner_id, name: row.name || "Untitled collection",
        description: row.description, visibility: row.visibility === "public" ? "public" as const : "private" as const,
        syncStatus: "synced", lifecycle: "server-confirmed", deletedAt: null,
        createdAt: row.created_at, updatedAt: row.updated_at, localUpdatedAt: Date.parse(row.updated_at) || now,
      }))
      const known = new Set(collections.map((row) => row.id))
      const writingCollections = (relationResult.data ?? []).filter((row) => known.has(row.collection_id)).map((row) => ({
        writingId: row.writing_id, collectionId: row.collection_id,
        addedAt: row.added_at ?? new Date(now).toISOString(), localUpdatedAt: Date.parse(row.added_at ?? "") || now,
      }))
      await tauriCatalogApplyCollectionSnapshot((await catalog()).dbPath, { collections, writingCollections })
      return ok({ appliedCount: collections.length })
    } catch (error) { return fail("UNAVAILABLE", error instanceof Error ? error.message : "Collection hydration failed") }
  },

  async flushPending(): Promise<ServiceResponse<FlushSyncResult>> {
    try {
      const userId = await sessionUserId()
      if (!userId) return fail("UNAUTHORIZED", "Sign in to sync pending documents")
      const store = await catalog()
      const pending = await tauriCatalogListPendingMutations(store.dbPath, Date.now(), 200)
      const metadataPending = await tauriCatalogListPendingMetadataMutations(store.dbPath, Date.now(), 200)
      const failed: string[] = []
      for (const mutation of pending) {
        try {
          await processMutation(userId, mutation)
          await tauriCatalogUpdateMutationStatus(store.dbPath, mutation.id, "synced", mutation.attemptCount, null, null)
        } catch (error) {
          failed.push(mutation.id)
          const attempts = mutation.attemptCount + 1
          const retryAt = Date.now() + Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8))
          await tauriCatalogUpdateMutationStatus(
            store.dbPath, mutation.id, "failed", attempts, retryAt,
            error instanceof Error ? error.message : "Sync failed",
          )
        }
      }
      for (const mutation of metadataPending) {
        try {
          await processMetadataMutation(userId, mutation)
          await tauriCatalogUpdateMetadataMutationStatus(store.dbPath, mutation.id, "synced", mutation.attemptCount, null, null)
        } catch (error) {
          failed.push(mutation.id)
          const attempts = mutation.attemptCount + 1
          const retryAt = Date.now() + Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8))
          await tauriCatalogUpdateMetadataMutationStatus(
            store.dbPath, mutation.id, "failed", attempts, retryAt,
            error instanceof Error ? error.message : "Sync failed",
          )
        }
      }
      const processed = pending.length + metadataPending.length
      if (processed > 0 && failed.length === 0) lastSyncedAt = new Date().toISOString()
      return ok({ processedMutations: processed, failedMutations: failed, nextRetryAt: null })
    } catch (error) { return fail("UNAVAILABLE", error instanceof Error ? error.message : "Flush failed") }
  },

  async scheduleFlush() {
    if (scheduled) clearTimeout(scheduled)
    scheduled = setTimeout(() => { scheduled = null; void desktopCatalogSyncService.flushPending() }, 1500)
    return ok(undefined)
  },
  async start() { started = true; return ok(undefined) },
  async stop() { started = false; if (scheduled) clearTimeout(scheduled); scheduled = null; return ok(undefined) },
  async getRuntimeState(): Promise<ServiceResponse<SyncRuntimeState>> {
    try {
      const store = await catalog()
      const pending = await tauriCatalogListPendingMutations(store.dbPath, Date.now(), 5000)
      const metadataPending = await tauriCatalogListPendingMetadataMutations(store.dbPath, Date.now(), 5000)
      const allPending = pending.length + metadataPending.length
      return ok({
        status: allPending > 0 ? (started ? "pending" : "offline") : "synced",
        pendingMutations: allPending,
        nextRetryAt: pending.reduce<number | null>((next, row) =>
          row.nextRetryAt !== null && (next === null || row.nextRetryAt < next) ? row.nextRetryAt : next, null),
        lastSyncedAt,
      })
    } catch (error) { return fail("UNAVAILABLE", error instanceof Error ? error.message : "Status unavailable") }
  },
}
