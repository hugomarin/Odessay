import { localDB } from "@/lib/local-db"
import type { LocalWriting, WritingStatus, WritingVisibility } from "@/lib/local-db/schema"
import { normalizeArtifactType, type ArtifactType } from "@/lib/writings/artifact-type"
import { normalizeWritingStatus } from "@/lib/writings/status"

type ApiEnvelope<T> = {
  data: T
  error: { code: string; message: string } | null
}

export type RemoteWritingListRecord = {
  id: string
  author_id: string
  title: string | null
  slug: string | null
  status: WritingStatus | "finished" | null
  artifact_type?: ArtifactType | string | null
  visibility: WritingVisibility | null
  parent_id: string | null
  correspondence_id: string | null
  version: number | null
  sync_status: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  content_hash?: string | null
  content_updated_at?: string | null
  metadata_updated_at?: string | null
}

export type RemoteWritingRecord = RemoteWritingListRecord & {
  body_json: Record<string, unknown> | null
  body_text: string | null
}

function hasBodyFields(
  record: RemoteWritingListRecord,
): record is RemoteWritingRecord {
  return "body_json" in record && (record as RemoteWritingRecord).body_json !== undefined
}

const EMPTY_BODY_JSON: Record<string, unknown> = {
  type: "doc",
  content: [],
}

export const parseTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return 0
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

export const normalizeVersion = (value: number | null | undefined) => {
  if (!Number.isInteger(value) || (value ?? 0) < 1) {
    return 1
  }

  return value as number
}

const normalizeVisibility = (value: string | null | undefined): WritingVisibility =>
  value === "shared" || value === "public" ? value : "private"

const normalizeBodyJson = (value: Record<string, unknown> | null): Record<string, unknown> =>
  value && typeof value === "object" ? value : EMPTY_BODY_JSON

export const shouldApplyRemoteWriting = (
  localWriting: LocalWriting | null,
  remoteWriting: RemoteWritingListRecord,
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

export const mapRemoteWritingToLocal = (
  remoteWriting: RemoteWritingListRecord,
  existingLocalWriting?: LocalWriting | null,
): LocalWriting => {
  const updatedAtMs = parseTimestamp(remoteWriting.updated_at)
  const hasBody = hasBodyFields(remoteWriting)

  return {
    id: remoteWriting.id,
    author_id: remoteWriting.author_id,
    title: remoteWriting.title ?? null,
    canonical_path: existingLocalWriting?.canonical_path ?? null,
    body_json: hasBody
      ? normalizeBodyJson(remoteWriting.body_json)
      : (existingLocalWriting?.body_json ?? EMPTY_BODY_JSON),
    body_text: hasBody
      ? (remoteWriting.body_text ?? "")
      : (existingLocalWriting?.body_text ?? ""),
    content_hash: remoteWriting.content_hash ?? existingLocalWriting?.content_hash ?? null,
    slug: remoteWriting.slug ?? null,
    status: normalizeWritingStatus(remoteWriting.status),
    artifact_type: normalizeArtifactType(remoteWriting.artifact_type),
    visibility: normalizeVisibility(remoteWriting.visibility),
    parent_id: remoteWriting.parent_id ?? null,
    correspondence_id: remoteWriting.correspondence_id ?? null,
    version: normalizeVersion(remoteWriting.version),
    sync_status: remoteWriting.deleted_at ? "deleted" : "synced",
    lifecycle: "server-confirmed",
    deleted_at: remoteWriting.deleted_at ?? null,
    created_at: remoteWriting.created_at,
    updated_at: remoteWriting.updated_at,
    content_updated_at: remoteWriting.content_updated_at ?? remoteWriting.updated_at,
    metadata_updated_at: remoteWriting.metadata_updated_at ?? remoteWriting.updated_at,
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

export const normalizeContentHash = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed || null
}

const hasMaterializedPath = (writing: LocalWriting) => Boolean(writing.canonical_path?.trim())

const isEligibleHashRebindCandidate = async (
  writing: LocalWriting,
  remoteWriting: RemoteWritingListRecord,
) => {
  if (writing.id === remoteWriting.id || writing.deleted_at || writing.sync_status === "deleted") {
    return false
  }

  if (!hasMaterializedPath(writing)) {
    return false
  }

  if (normalizeContentHash(writing.content_hash) !== normalizeContentHash(remoteWriting.content_hash)) {
    return false
  }

  const activeMutation = await localDB.syncQueue.getCurrentForWriting(writing.id)
  return !activeMutation
}

const findUniqueHashRebindCandidate = async (
  remoteWriting: RemoteWritingListRecord,
): Promise<LocalWriting | null> => {
  if (remoteWriting.deleted_at || !normalizeContentHash(remoteWriting.content_hash)) {
    return null
  }

  const localWritings = await localDB.writings.getAll({ includeDeleted: true })
  const candidates: LocalWriting[] = []

  for (const writing of localWritings) {
    if (await isEligibleHashRebindCandidate(writing, remoteWriting)) {
      candidates.push(writing)
    }
  }

  return candidates.length === 1 ? candidates[0] : null
}

const retireReboundLocalWriting = async (writing: LocalWriting) => {
  const nowIso = new Date().toISOString()
  await localDB.writings.save({
    ...writing,
    canonical_path: null,
    sync_status: "deleted",
    deleted_at: nowIso,
    updated_at: nowIso,
    version: writing.version + 1,
    local_updated_at: Date.now(),
  })
}

export const applyRemoteSoftDelete = async (
  localWriting: LocalWriting,
  remoteWriting: RemoteWritingListRecord,
): Promise<boolean> => {
  if (!shouldApplyRemoteWriting(localWriting, remoteWriting)) {
    return false
  }

  await localDB.writings.save({
    ...localWriting,
    sync_status: "deleted",
    deleted_at: remoteWriting.deleted_at,
    updated_at: remoteWriting.updated_at,
    version: normalizeVersion(remoteWriting.version),
    local_updated_at: Date.now(),
  })

  return true
}

export const mergeRemoteWriting = async (remoteWriting: RemoteWritingListRecord) => {
  const localWriting = await localDB.writings.get(remoteWriting.id)
  const hashRebindCandidate = localWriting ? null : await findUniqueHashRebindCandidate(remoteWriting)
  const existingLocalWriting = localWriting ?? hashRebindCandidate

  if (localWriting && !shouldApplyRemoteWriting(localWriting, remoteWriting)) {
    return false
  }

  await localDB.writings.save(mapRemoteWritingToLocal(remoteWriting, existingLocalWriting))

  if (hashRebindCandidate) {
    await retireReboundLocalWriting(hashRebindCandidate)
  }

  return true
}

export const needsBodyFetch = (
  localWriting: LocalWriting | null,
  remoteWriting: RemoteWritingListRecord,
): boolean => {
  if (!localWriting) {
    return true
  }

  if (remoteWriting.deleted_at) {
    return false
  }

  if (localWriting.sync_status !== "synced") {
    return false
  }

  const localHash = normalizeContentHash(localWriting.content_hash)
  const remoteHash = normalizeContentHash(remoteWriting.content_hash)

  if (localHash && remoteHash && localHash !== remoteHash) {
    return true
  }

  return parseTimestamp(remoteWriting.updated_at) > parseTimestamp(localWriting.updated_at)
}

let inFlightWritingsHydration: Promise<number> | null = null

export const hydrateLocalWritingsFromRemote = (): Promise<number> => {
  if (inFlightWritingsHydration) {
    return inFlightWritingsHydration
  }

  const promise = (async () => {
    // Phase 1: manifest — lightweight metadata for every accessible writing.
    const manifestResponse = await fetch("/api/writings?fields=manifest", {
      method: "GET",
      cache: "no-store",
    })
    const manifest = await parseEnvelope<RemoteWritingListRecord[]>(manifestResponse)

    const changedIds: string[] = []
    const deleteEntries: RemoteWritingListRecord[] = []

    for (const remoteWriting of manifest) {
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

    // Phase 2: fetch full bodies only for writings that actually changed.
    let remoteBodies: RemoteWritingRecord[] = []
    if (changedIds.length > 0) {
      const idsParam = changedIds.join(",")
      const bodiesResponse = await fetch(`/api/writings?ids=${encodeURIComponent(idsParam)}`, {
        method: "GET",
        cache: "no-store",
      })
      remoteBodies = await parseEnvelope<RemoteWritingRecord[]>(bodiesResponse)
    }

    let appliedCount = 0

    for (const deleteEntry of deleteEntries) {
      const localWriting = await localDB.writings.get(deleteEntry.id)
      if (!localWriting) {
        continue
      }

      if (await applyRemoteSoftDelete(localWriting, deleteEntry)) {
        appliedCount += 1
      }
    }

    const requestedIds = new Set(changedIds)

    for (const remoteWriting of remoteBodies) {
      if (!requestedIds.has(remoteWriting.id)) {
        // Defensive: the server returned an id we did not request (deleted
        // between phases or RLS change). Log and skip rather than failing the
        // whole batch.
        console.warn("[remote-bootstrap] phase-2 response omitted requested id", {
          writingId: remoteWriting.id,
        })
        continue
      }

      requestedIds.delete(remoteWriting.id)

      if (await mergeRemoteWriting(remoteWriting)) {
        appliedCount += 1
      }
    }

    for (const missingId of requestedIds) {
      console.warn("[remote-bootstrap] phase-2 response missing requested id", {
        writingId: missingId,
      })
    }

    return appliedCount
  })().finally(() => {
    inFlightWritingsHydration = null
  })

  inFlightWritingsHydration = promise
  return promise
}

export const hasLocalBody = (local: LocalWriting): boolean => {
  if (local.body_text !== "") {
    return true
  }

  const content = (local.body_json as { content?: unknown[] } | null | undefined)?.content
  return Array.isArray(content) && content.length > 0
}

export const needsBodyHydration = (local: LocalWriting | null | undefined): boolean => {
  if (!local) {
    return true
  }

  if (local.lifecycle === "local-only") {
    return false
  }

  if (local.sync_status !== "synced") {
    return false
  }

  return !hasLocalBody(local)
}

const inFlightBodyHydrations = new Map<string, Promise<boolean>>()

export const hydrateLocalWritingFromRemote = (writingId: string): Promise<boolean> => {
  // The inFlight slot is claimed synchronously so concurrent callers that share
  // the same writingId observe the same pending promise. Without this, two
  // entry-path effects firing in the same tick (StrictMode double-mount,
  // race between Desk row click and tab focus, etc.) would both pass the
  // `needsBodyHydration` check before either had a chance to register.
  const existing = inFlightBodyHydrations.get(writingId)
  if (existing) {
    return existing
  }

  const promise = (async () => {
    const local = await localDB.writings.get(writingId)
    if (!needsBodyHydration(local)) {
      return false
    }

    const response = await fetch(`/api/writings/${writingId}`, {
      method: "GET",
      cache: "no-store",
    })
    const remoteWriting = await parseEnvelope<RemoteWritingRecord>(response)
    return mergeRemoteWriting(remoteWriting)
  })().finally(() => {
    inFlightBodyHydrations.delete(writingId)
  })

  inFlightBodyHydrations.set(writingId, promise)
  return promise
}
