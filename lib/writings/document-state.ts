import type { LocalSyncStatus, LocalWriting, WritingLifecycle } from "@/lib/local-db/schema"

export type DocumentState = "cloud-only" | "local-only" | "synced" | "pending" | "sync-failed"

export type DocumentStateSignals = {
  hasCloudRecord: boolean
  hasLocalFile: boolean
  isPending: boolean
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
