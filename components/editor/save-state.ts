import type { LocalWriting } from "@/lib/local-db/schema"
import type { WritingLifecycle } from "@/lib/local-db/schema"
import type { SyncLifecycleStatus } from "@/lib/sync/events"

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
