import type { LocalWriting } from "@/lib/local-db/schema"
import type { WritingLifecycle } from "@/lib/local-db/schema"
import type { SyncLifecycleStatus } from "@/lib/sync/events"
import type { CatalogSyncStatus } from "@/lib/services/contracts/document-catalog"

// ODE-461: "saving" is ambiguous by design between "cloud sync pending" (fine,
// content is already local-durable) and "the local save itself failed" (the
// author's content was never written). "error" names only the second case —
// a durable local-write failure — never a remote sync retry.
export type EditorSaveState = "saved" | "saving" | "saved-local" | "error"

export const mapSyncLifecycleToSaveState = (
  status: SyncLifecycleStatus,
): EditorSaveState => {
  if (status === "synced") {
    return "saved"
  }

  if (status === "offline") {
    return "saved-local"
  }

  return "saving"
}

export const mapLocalSyncStatusToSaveState = (
  syncStatus: LocalWriting["sync_status"],
  lifecycle: WritingLifecycle,
  isOnline: boolean,
): EditorSaveState => {
  if (syncStatus !== "synced") {
    if (!isOnline) {
      return "saved-local"
    }

    return "saving"
  }

  if (lifecycle === "local-only") {
    return "saved-local"
  }

  return "saved"
}

// ODE-542: durable save-state projection. The SQLite DocumentCatalog is the
// terminal reference for save/sync; ephemeral sync CustomEvents are only
// deltas/invalidations that may be lost during draft materialization or
// hydration. This mapping mirrors `createEditorHydrationRecord` so hydration,
// event-invalidation and materialization all project the same snapshot.
export type DurableSaveSnapshot = {
  syncStatus: CatalogSyncStatus
  cloudPresent: boolean
}

export const mapCatalogRecordToSaveState = (
  record: DurableSaveSnapshot,
  isOnline: boolean,
): EditorSaveState => {
  const lifecycle: WritingLifecycle = record.cloudPresent ? "server-confirmed" : "local-only"
  const writingSyncStatus: LocalWriting["sync_status"] =
    record.syncStatus === "pending"
      ? "pending"
      : record.syncStatus === "failed" || record.syncStatus === "conflict"
        ? "failed"
        : record.syncStatus === "deleted"
          ? "deleted"
          : "synced"

  return mapLocalSyncStatusToSaveState(writingSyncStatus, lifecycle, isOnline)
}

export const isDurableTerminalSyncStatus = (syncStatus: CatalogSyncStatus): boolean =>
  syncStatus === "synced" || syncStatus === "local-only"

// ODE-542: one-way healing. Only a terminal durable state (synced/local-only)
// may move the UI; a non-terminal durable (pending/failed/conflict/deleted)
// leaves the UI driven by local persist + sync events. `error` (durable local
// write failure, ODE-461) is never auto-cleared by a cloud snapshot.
export const reconcileSaveStateFromDurable = ({
  current,
  durable,
  isOnline,
}: {
  current: EditorSaveState
  durable: DurableSaveSnapshot | null
  isOnline: boolean
}): EditorSaveState | null => {
  if (current === "error") {
    return null
  }

  if (!durable) {
    return null
  }

  if (!isDurableTerminalSyncStatus(durable.syncStatus)) {
    return null
  }

  const next = mapCatalogRecordToSaveState(durable, isOnline)

  if (next === current || next === "error") {
    return null
  }

  return next
}

export const saveStateToHasPendingSync = (saveState: EditorSaveState): boolean =>
  saveState !== "saved"

export const formatSaveStateDiagnostic = ({
  writingId,
  durableSyncStatus,
  current,
  next,
  reason,
}: {
  writingId: string
  durableSyncStatus: CatalogSyncStatus
  current: EditorSaveState
  next: EditorSaveState
  reason: string
}): string =>
  `[editor:save-state] reconcile writingId=${writingId} durable=${durableSyncStatus} current=${current} next=${next} reason=${reason}`
