import { localDB } from "@/lib/local-db"
import type { LocalWriting, WritingStatus, WritingVisibility } from "@/lib/local-db/schema"

type ApiEnvelope<T> = {
  data: T
  error: { code: string; message: string } | null
}

export type RemoteWritingRecord = {
  id: string
  author_id: string
  title: string | null
  body_json: Record<string, unknown> | null
  body_text: string | null
  slug: string | null
  status: WritingStatus | null
  visibility: WritingVisibility | null
  parent_id: string | null
  correspondence_id: string | null
  version: number | null
  sync_status: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

const EMPTY_BODY_JSON: Record<string, unknown> = {
  type: "doc",
  content: [],
}

const parseTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return 0
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

const normalizeVersion = (value: number | null | undefined) => {
  if (!Number.isInteger(value) || (value ?? 0) < 1) {
    return 1
  }

  return value as number
}

const normalizeStatus = (value: string | null | undefined): WritingStatus =>
  value === "finished" ? "finished" : "draft"

const normalizeVisibility = (value: string | null | undefined): WritingVisibility =>
  value === "shared" || value === "public" ? value : "private"

const normalizeBodyJson = (value: Record<string, unknown> | null): Record<string, unknown> =>
  value && typeof value === "object" ? value : EMPTY_BODY_JSON

export const shouldApplyRemoteWriting = (
  localWriting: LocalWriting | null,
  remoteWriting: RemoteWritingRecord,
) => {
  if (!localWriting) {
    return true
  }

  if (localWriting.sync_status !== "synced") {
    return false
  }

  const localVersion = normalizeVersion(localWriting.version)
  const remoteVersion = normalizeVersion(remoteWriting.version)

  if (remoteVersion > localVersion) {
    return true
  }

  if (remoteVersion < localVersion) {
    return false
  }

  return parseTimestamp(remoteWriting.updated_at) >= parseTimestamp(localWriting.updated_at)
}

export const mapRemoteWritingToLocal = (remoteWriting: RemoteWritingRecord): LocalWriting => {
  const updatedAtMs = parseTimestamp(remoteWriting.updated_at)

  return {
    id: remoteWriting.id,
    author_id: remoteWriting.author_id,
    title: remoteWriting.title ?? null,
    body_json: normalizeBodyJson(remoteWriting.body_json),
    body_text: remoteWriting.body_text ?? "",
    slug: remoteWriting.slug ?? null,
    status: normalizeStatus(remoteWriting.status),
    visibility: normalizeVisibility(remoteWriting.visibility),
    parent_id: remoteWriting.parent_id ?? null,
    correspondence_id: remoteWriting.correspondence_id ?? null,
    version: normalizeVersion(remoteWriting.version),
    sync_status: remoteWriting.deleted_at ? "deleted" : "synced",
    deleted_at: remoteWriting.deleted_at ?? null,
    created_at: remoteWriting.created_at,
    updated_at: remoteWriting.updated_at,
    local_updated_at: updatedAtMs || Date.now(),
  }
}

const parseEnvelope = async <T>(response: Response): Promise<T> => {
  const envelope = (await response.json()) as ApiEnvelope<T>

  if (!response.ok || envelope.error) {
    throw new Error(envelope.error?.message ?? `Request failed with status ${response.status}.`)
  }

  return envelope.data
}

const mergeRemoteWriting = async (remoteWriting: RemoteWritingRecord) => {
  const localWriting = await localDB.writings.get(remoteWriting.id)

  if (!shouldApplyRemoteWriting(localWriting, remoteWriting)) {
    return false
  }

  await localDB.writings.save(mapRemoteWritingToLocal(remoteWriting))
  return true
}

export const hydrateLocalWritingsFromRemote = async () => {
  const response = await fetch("/api/writings", {
    method: "GET",
    cache: "no-store",
  })
  const remoteWritings = await parseEnvelope<RemoteWritingRecord[]>(response)

  let appliedCount = 0

  for (const remoteWriting of remoteWritings) {
    const applied = await mergeRemoteWriting(remoteWriting)
    if (applied) {
      appliedCount += 1
    }
  }

  return appliedCount
}

export const hydrateLocalWritingFromRemote = async (writingId: string) => {
  const response = await fetch(`/api/writings/${writingId}`, {
    method: "GET",
    cache: "no-store",
  })
  const remoteWriting = await parseEnvelope<RemoteWritingRecord>(response)
  const applied = await mergeRemoteWriting(remoteWriting)
  return applied
}
