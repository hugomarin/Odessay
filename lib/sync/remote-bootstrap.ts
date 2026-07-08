import { getLocalDBScope, localDB } from "@/lib/local-db"
import { createHydrationFreshness } from "@/lib/sync/hydration-freshness"
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

const buildLocalCandidateIndex = async (): Promise<Map<string, LocalWriting[]>> => {
  const localWritings = await localDB.writings.getAll({ includeDeleted: false })
  const index = new Map<string, LocalWriting[]>()

  for (const writing of localWritings) {
    const hash = normalizeContentHash(writing.content_hash)
    if (!hash || !hasMaterializedPath(writing)) {
      continue
    }

    const list = index.get(hash) ?? []
    list.push(writing)
    index.set(hash, list)
  }

  return index
}

const findUniqueHashRebindCandidate = async (
  remoteWriting: RemoteWritingListRecord,
  candidates?: LocalWriting[],
): Promise<LocalWriting | null> => {
  const hash = normalizeContentHash(remoteWriting.content_hash)
  if (remoteWriting.deleted_at || !hash) {
    return null
  }

  const candidateList = candidates ?? (await localDB.writings.getByContentHash(hash))
  const eligibleCandidates: LocalWriting[] = []

  for (const writing of candidateList) {
    if (await isEligibleHashRebindCandidate(writing, remoteWriting)) {
      eligibleCandidates.push(writing)
    }
  }

  return eligibleCandidates.length === 1 ? eligibleCandidates[0] : null
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

export const mergeRemoteWriting = async (
  remoteWriting: RemoteWritingListRecord,
  candidateIndex?: Map<string, LocalWriting[]>,
) => {
  const localWriting = await localDB.writings.get(remoteWriting.id)
  const hash = normalizeContentHash(remoteWriting.content_hash)
  const candidates = hash ? candidateIndex?.get(hash) : undefined
  const hashRebindCandidate = localWriting
    ? null
    : await findUniqueHashRebindCandidate(remoteWriting, candidates)
  const existingLocalWriting = localWriting ?? hashRebindCandidate

  if (localWriting && !shouldApplyRemoteWriting(localWriting, remoteWriting)) {
    return false
  }

  const mappedRemote = mapRemoteWritingToLocal(remoteWriting, existingLocalWriting)

  if (hashRebindCandidate) {
    await localDB.writings.saveWithRebind({
      remoteWriting: mappedRemote,
      candidate: hashRebindCandidate,
    })
  } else {
    await localDB.writings.save(mappedRemote)
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

// Must match MAX_BATCH_IDS in app/api/writings/route.ts: the API rejects
// requests with more ids, so phase 2 fetches bodies in chunks of this size.
const BODY_FETCH_BATCH_SIZE = 200

let inFlightWritingsHydration: Promise<number> | null = null

const writingsHydrationFreshness = createHydrationFreshness()

/**
 * Clear the web writings freshness window so the next hydrate call hits the
 * network. Used by explicit refresh flows (window focus / online) that must
 * bypass the window — mirrors invalidateHydrationFreshness on desktop.
 */
export const invalidateWebWritingsHydrationFreshness = (scope?: string): void => {
  writingsHydrationFreshness.invalidate(scope)
}

export const hydrateLocalWritingsFromRemote = (): Promise<number> => {
  if (inFlightWritingsHydration) {
    return inFlightWritingsHydration
  }

  // Sequential callers inside the freshness window reuse local state without
  // issuing another request (single-flight only covers concurrent callers).
  const scope = getLocalDBScope()
  if (writingsHydrationFreshness.isFresh(scope)) {
    return Promise.resolve(0)
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
    const candidateIndex = await buildLocalCandidateIndex()

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

    // Phase 2: fetch full bodies only for writings that actually changed,
    // chunked so no request exceeds the API's batch id limit.
    const remoteBodies: RemoteWritingRecord[] = []
    for (let start = 0; start < changedIds.length; start += BODY_FETCH_BATCH_SIZE) {
      const chunk = changedIds.slice(start, start + BODY_FETCH_BATCH_SIZE)
      const idsParam = chunk.join(",")
      const bodiesResponse = await fetch(`/api/writings?ids=${encodeURIComponent(idsParam)}`, {
        method: "GET",
        cache: "no-store",
      })
      remoteBodies.push(...(await parseEnvelope<RemoteWritingRecord[]>(bodiesResponse)))
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
        console.warn("[remote-bootstrap] phase-2 response returned an id that was not requested", {
          writingId: remoteWriting.id,
        })
        continue
      }

      requestedIds.delete(remoteWriting.id)

      if (await mergeRemoteWriting(remoteWriting, candidateIndex)) {
        appliedCount += 1
      }
    }

    for (const missingId of requestedIds) {
      console.warn("[remote-bootstrap] phase-2 response missing requested id", {
        writingId: missingId,
      })
    }

    // Only a successful hydration for a still-active scope counts as fresh;
    // failures reject before reaching this line, so the next attempt retries.
    if (getLocalDBScope() === scope) {
      writingsHydrationFreshness.markFresh(scope)
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
