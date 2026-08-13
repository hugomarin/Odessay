import type { LocalSyncStatus, LocalWriting, WritingLifecycle } from "@/lib/local-db/schema"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"

/**
 * The complete document-state vocabulary shared by Desk and Workspace.
 *
 * The first five values are identity/sync states derived from local+cloud
 * presence and the sync queue. `conflict`, `ambiguous`, `stale` and
 * `rebuilding` are the operational/recovery states the DocumentCatalog can
 * surface (spec `odessay-desktop-document-catalog.md` §Modelo de estados +
 * §Fallos y recuperación). Both surfaces render the same enum so a given UUID
 * shows one state everywhere.
 */
export type DocumentState =
  | "cloud-only"
  | "local-only"
  | "synced"
  | "pending"
  | "sync-failed"
  | "archived"
  | "conflict"
  | "ambiguous"
  | "stale"
  | "rebuilding"

export type DocumentStateSignals = {
  hasCloudRecord: boolean
  hasLocalFile: boolean
  isPending: boolean
}

/**
 * Operational overlays the catalog view attaches per-document (ambiguous
 * binding) or list-wide (stale watcher / rebuilding SQLite). They dominate the
 * presence-derived state because identity must resolve before a document can be
 * classified (spec §"La identidad se resuelve antes del estado").
 */
export type CatalogStateSignals = {
  ambiguous?: boolean
  stale?: boolean
  rebuilding?: boolean
}

export type DocumentStateSource = Pick<LocalWriting, "canonical_path" | "lifecycle" | "sync_status">

const pendingSyncStatuses: ReadonlySet<LocalSyncStatus> = new Set(["pending"])

export function deriveDocumentStateFromSignals({
  hasCloudRecord,
  hasLocalFile,
  isPending,
}: DocumentStateSignals): DocumentState {
  if (isPending) {
    return "pending"
  }

  if (hasCloudRecord && hasLocalFile) {
    return "synced"
  }

  if (hasCloudRecord) {
    return "cloud-only"
  }

  return "local-only"
}

export function hasMaterializedLocalFile(canonicalPath: string | null | undefined): boolean {
  return Boolean(canonicalPath?.trim())
}

export function hasCloudRecord(lifecycle: WritingLifecycle): boolean {
  return lifecycle === "server-confirmed"
}

export function isDocumentStatePending(syncStatus: LocalSyncStatus, lifecycle: WritingLifecycle): boolean {
  return pendingSyncStatuses.has(syncStatus) || lifecycle === "syncing"
}

export function deriveDocumentStateForLocalWriting(writing: DocumentStateSource): DocumentState {
  if (writing.sync_status === "failed") {
    return "sync-failed"
  }

  return deriveDocumentStateFromSignals({
    hasCloudRecord: hasCloudRecord(writing.lifecycle),
    hasLocalFile: hasMaterializedLocalFile(writing.canonical_path),
    isPending: isDocumentStatePending(writing.sync_status, writing.lifecycle),
  })
}

type CatalogStateSource = Pick<
  DocumentCatalogRecord,
  "localPresent" | "cloudPresent" | "cloudAccountId" | "deletedAt" | "syncStatus"
>

/**
 * The single derivation Desk and Workspace share when reading DocumentCatalog
 * records. Because both surfaces run identical records through this function,
 * the same UUID resolves to the same state in every view (ODE-373 parity
 * invariant). Operational signals win over presence/sync signals.
 */
export function deriveDocumentStateFromCatalogRecord(
  record: CatalogStateSource,
  signals: CatalogStateSignals = {},
): DocumentState {
  if (signals.rebuilding) {
    return "rebuilding"
  }

  if (signals.ambiguous) {
    return "ambiguous"
  }

  if (record.syncStatus === "conflict") {
    return "conflict"
  }

  if (signals.stale) {
    return "stale"
  }

  if (record.syncStatus === "failed") {
    return "sync-failed"
  }

  if (record.deletedAt !== null && record.cloudAccountId !== null) {
    return "archived"
  }

  return deriveDocumentStateFromSignals({
    hasCloudRecord: record.cloudAccountId !== null,
    hasLocalFile: record.localPresent,
    isPending: record.syncStatus === "pending",
  })
}
