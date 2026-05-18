import type { LocalWriting } from "@/lib/local-db/schema"
import type { WritingLifecycle } from "@/lib/local-db/schema"
import type { SyncLifecycleStatus } from "@/lib/sync/events"

export type EditorSaveState = "saved" | "saving" | "saved-local"

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
