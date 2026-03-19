export const SYNC_STATUS_EVENT_NAME = "odessay:sync-status-change"

export type SyncLifecycleStatus = "pending" | "syncing" | "synced" | "retrying" | "offline"

export type SyncStatusEventDetail = {
  writingId: string
  status: SyncLifecycleStatus
}

const canDispatchSyncEvent = () =>
  typeof window !== "undefined" &&
  typeof window.dispatchEvent === "function" &&
  typeof window.CustomEvent === "function"

export const emitSyncStatusChange = (detail: SyncStatusEventDetail) => {
  if (!canDispatchSyncEvent()) {
    return
  }

  window.dispatchEvent(new window.CustomEvent<SyncStatusEventDetail>(SYNC_STATUS_EVENT_NAME, { detail }))
}

export const subscribeToSyncStatusChanges = (
  listener: (detail: SyncStatusEventDetail) => void,
) => {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => {}
  }

  const handler = (event: Event) => {
    const syncEvent = event as CustomEvent<SyncStatusEventDetail>

    if (!syncEvent.detail) {
      return
    }

    listener(syncEvent.detail)
  }

  window.addEventListener(SYNC_STATUS_EVENT_NAME, handler as EventListener)

  return () => {
    window.removeEventListener(SYNC_STATUS_EVENT_NAME, handler as EventListener)
  }
}
