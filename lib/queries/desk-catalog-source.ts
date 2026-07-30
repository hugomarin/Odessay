import {
  getLocalDBScope,
  localDB,
  subscribeToLocalDBChanges,
  subscribeToLocalDBScopeChanges,
} from "@/lib/local-db"
import {
  createLocalCollection as createWebCollection,
  deleteLocalCollection as deleteWebCollection,
  setLocalWritingCollections as setWebWritingCollections,
  updateLocalCollection as updateWebCollection,
} from "@/lib/local-db/collections"
import type {
  LocalCollection,
  LocalWriting,
  LocalWritingCollection,
} from "@/lib/local-db/schema"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { loadCatalogRecords } from "@/lib/queries/document-catalog"
import { getDocumentCatalog } from "@/lib/services/document-catalog-factory"
import {
  deriveDocumentStateFromCatalogRecord,
  type DocumentState,
} from "@/lib/writings/document-state"
import {
  createDesktopCollection,
  deleteDesktopCollection,
  loadDesktopCollections,
  setDesktopWritingCollections,
  updateDesktopCollection,
} from "@/lib/services/desktop/desktop-collection-service"

/**
 * Application query port for Desk (ODE-373).
 *
 * Desk's presentation component must not read storage directly. This module is
 * the application layer that owns that access: it takes the base document set and
 * its state from the DocumentCatalog, then joins local enrichment (bodies,
 * collections, assignments) that the catalog deliberately excludes. The Desk page
 * imports only from here, so no IndexedDB/SQLite/runtime import decides identity
 * or state in the UI.
 */

const CATALOG_LIST_LIMIT = 10_000
const desktopCollectionListeners = new Set<() => void>()
const emitDesktopCollectionChange = () => desktopCollectionListeners.forEach((listener) => listener())
const isActiveCatalogRecord = (record: DocumentCatalogRecord) => record.deletedAt === null

/**
 * Whether Desk/Workspace read their base set from the DocumentCatalog.
 *
 * Web always reads through the catalog — its adapter wraps the same IndexedDB
 * store, so the cutover is behaviour-preserving. M4 makes the SQLite catalog the
 * default desktop read path. The same flag remains as an explicit `false` rollback
 * switch, preserving the reversible fallback required until M6. This is the read
 * cutover, not a data migration (Requirement 10).
 */
export function isCatalogReadEnabled(): boolean {
  return true
}

export type DeskCatalogData = {
  /** Base membership = catalog records, enriched with local bodies where present. */
  writings: LocalWriting[]
  /** Authoritative document state per UUID, derived from the catalog. */
  documentStateById: Record<string, DocumentState>
  collections: LocalCollection[]
  writingCollections: LocalWritingCollection[]
  userId: string | null
}

const CATALOG_TO_LOCAL_SYNC: Record<DocumentCatalogRecord["syncStatus"], LocalWriting["sync_status"]> = {
  "local-only": "synced",
  pending: "pending",
  synced: "synced",
  conflict: "synced",
  failed: "failed",
  deleted: "deleted",
}

const toIso = (value: number | null): string =>
  value ? new Date(value).toISOString() : new Date(0).toISOString()

/**
 * Synthesize a Desk row for a catalog record that has no local body yet (e.g. a
 * cloud-only document). It carries identity/state/metadata from the catalog and
 * an empty body; it is never written back to storage.
 */
function synthesizeWritingFromRecord(record: DocumentCatalogRecord): LocalWriting {
  return {
    id: record.id,
    author_id: record.cloudAccountId,
    title: record.title,
    canonical_path: record.binding?.canonicalPath ?? null,
    body_json: {},
    body_text: record.excerpt ?? "",
    content_hash: record.binding?.contentHash ?? null,
    slug: record.slug,
    status: record.status ?? "draft",
    artifact_type: record.artifactType,
    visibility: record.visibility ?? "private",
    version: record.version ?? 1,
    sync_status: CATALOG_TO_LOCAL_SYNC[record.syncStatus] ?? "synced",
    lifecycle: record.cloudPresent ? "server-confirmed" : "local-only",
    created_at: toIso(record.createdAt),
    updated_at: toIso(record.modifiedAt),
    local_updated_at: record.modifiedAt ?? Date.now(),
  }
}

/**
 * Merge one catalog record with its local writing. Local supplies body and
 * correspondence enrichment; the catalog stays authoritative for identity and
 * cached metadata so the same UUID renders identically in Desk and Workspace.
 */
function mergeRecordWithLocal(
  record: DocumentCatalogRecord,
  local: LocalWriting | undefined,
): LocalWriting {
  if (!local) {
    return synthesizeWritingFromRecord(record)
  }

  return {
    ...local,
    title: record.title ?? local.title,
    slug: record.slug ?? local.slug,
    status: record.status ?? local.status,
    artifact_type: record.artifactType ?? local.artifact_type,
    visibility: record.visibility ?? local.visibility,
    canonical_path: record.binding?.canonicalPath ?? local.canonical_path,
    author_id: record.cloudAccountId ?? local.author_id,
  }
}

/**
 * Load Desk's base set from the DocumentCatalog and join local enrichment. When
 * the catalog read is not enabled (desktop, dual-write off) it falls back to the
 * legacy local set so the shipping app is unchanged.
 */
export async function loadDeskCatalogData(): Promise<DeskCatalogData> {
  const scope = getLocalDBScope()
  const userId = scope === "anonymous" ? null : scope

  if (isDesktopRuntime()) {
    const { desktopAuthService } = await import("@/lib/services/desktop-auth-service")
    const session = await desktopAuthService.getSession()
    const desktopUserId = session.data?.user?.id ?? null
    const [records, metadata] = await Promise.all([
      loadCatalogRecords({ cloudAccountId: desktopUserId, limit: CATALOG_LIST_LIMIT }),
      loadDesktopCollections(),
    ])
    const documentStateById: Record<string, DocumentState> = {}
    const writings = records.filter(isActiveCatalogRecord).map((record) => {
      documentStateById[record.id] = deriveDocumentStateFromCatalogRecord(record)
      return synthesizeWritingFromRecord(record)
    })
    return { writings, documentStateById, ...metadata, userId: desktopUserId }
  }

  const [localWritings, collections, writingCollections] = await Promise.all([
    localDB.writings.getAll(),
    localDB.collections.getAll(),
    localDB.writingCollections.listAll(),
  ])

  if (!isCatalogReadEnabled()) {
    // Reversible fallback: legacy local read. State still flows through the shared
    // catalog derivation so Desk and Workspace agree even on this path.
    const documentStateById: Record<string, DocumentState> = {}
    return { writings: localWritings, documentStateById, collections, writingCollections, userId }
  }

  const records = await loadCatalogRecords({ limit: CATALOG_LIST_LIMIT })
  const localById = new Map(localWritings.map((writing) => [writing.id, writing]))
  const documentStateById: Record<string, DocumentState> = {}
  const writings = records.filter(isActiveCatalogRecord).map((record) => {
    documentStateById[record.id] = deriveDocumentStateFromCatalogRecord(record)
    return mergeRecordWithLocal(record, localById.get(record.id))
  })

  return { writings, documentStateById, collections, writingCollections, userId }
}

/** Single-writing read for edit flows (rename, status, export), routed through the port. */
export async function getWritingForEdit(id: string): Promise<LocalWriting | undefined> {
  if (isDesktopRuntime()) {
    const record = await (await getDocumentCatalog()).getById(id)
    return record && isActiveCatalogRecord(record) ? synthesizeWritingFromRecord(record) : undefined
  }
  const local = (await localDB.writings.get(id)) ?? undefined
  if (!isCatalogReadEnabled()) {
    return local
  }

  const catalog = await getDocumentCatalog()
  const record = await catalog.getById(id)
  if (!record) {
    return local
  }
  if (!isActiveCatalogRecord(record)) return undefined

  return mergeRecordWithLocal(record, local)
}

/** Ids of shared, non-deleted writings — used to prefetch recipient previews. */
export async function loadSharedWritingIds(): Promise<string[]> {
  if (isDesktopRuntime()) {
    const records = await loadCatalogRecords({ limit: CATALOG_LIST_LIMIT })
    return records.filter((record) => isActiveCatalogRecord(record) && record.visibility === "shared").map((record) => record.id)
  }
  const writings = await localDB.writings.getAll()
  return writings
    .filter((writing) => writing.visibility === "shared" && writing.sync_status !== "deleted")
    .map((writing) => writing.id)
}

// Re-export the scope/collection ports so the Desk presentation imports storage
// access from one application module instead of reaching into @/lib/local-db.
export async function createLocalCollection(input: Parameters<typeof createWebCollection>[0]) {
  if (isDesktopRuntime()) {
    const result = await createDesktopCollection(input)
    emitDesktopCollectionChange()
    return result
  }
  return createWebCollection(input)
}

export async function setLocalWritingCollections(...input: Parameters<typeof setWebWritingCollections>) {
  if (isDesktopRuntime()) {
    const result = await setDesktopWritingCollections(...input)
    emitDesktopCollectionChange()
    return result
  }
  return setWebWritingCollections(...input)
}

export async function updateLocalCollection(...input: Parameters<typeof updateWebCollection>) {
  if (isDesktopRuntime()) {
    const result = await updateDesktopCollection(...input)
    emitDesktopCollectionChange()
    return result
  }
  return updateWebCollection(...input)
}

export async function deleteLocalCollection(...input: Parameters<typeof deleteWebCollection>) {
  if (isDesktopRuntime()) {
    const result = await deleteDesktopCollection(...input)
    emitDesktopCollectionChange()
    return result
  }
  return deleteWebCollection(...input)
}

export async function loadCollectionState(writingId?: string) {
  if (isDesktopRuntime()) {
    const state = await loadDesktopCollections()
    return {
      collections: state.collections,
      writingCollections: writingId
        ? state.writingCollections.filter((row) => row.writing_id === writingId)
        : state.writingCollections,
    }
  }
  const [collections, writingCollections] = await Promise.all([
    localDB.collections.getAll(),
    writingId ? localDB.writingCollections.listForWriting(writingId) : localDB.writingCollections.listAll(),
  ])
  return { collections, writingCollections }
}

export function subscribeToCollectionChanges(listener: () => void) {
  if (!isDesktopRuntime()) return subscribeToLocalDBChanges(listener)
  desktopCollectionListeners.add(listener)
  return () => desktopCollectionListeners.delete(listener)
}

export { getLocalDBScope, subscribeToLocalDBScopeChanges }
