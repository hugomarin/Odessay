import type {
  ArtifactType,
  DocumentService,
  WritingLifecycle,
  WritingRecord,
  WritingVisibility,
} from "@/lib/services/contracts/document-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import type { SyncService } from "@/lib/services/contracts/sync-service"
import type { WritingStatus } from "@/lib/writings/status"

/**
 * The persistence state machine is runtime-neutral. UI adapters can map these
 * states to their own presentation without taking ownership of the write
 * pipeline.
 */
export type PersistenceState =
  | "idle"
  | "dirty"
  | "persisting_local"
  | "queued_remote"
  | "synced"
  | "failed"

export type PersistenceSnapshotOverrides = {
  title?: string
  status?: WritingStatus
  artifactType?: ArtifactType
  visibility?: WritingVisibility
}

export type PersistenceSnapshot = {
  writingId: string | null
  createdAt: string | null
  version: number
  title: string
  bodyJson: Record<string, unknown>
  bodyText: string
  status: WritingStatus
  artifactType: ArtifactType
  visibility: WritingVisibility
  lifecycle: WritingLifecycle
  /** Stable UUID candidate used while a desktop draft is still ephemeral. */
  draftWritingId?: string | null
  /** Session tab that owns this snapshot while it is being persisted. */
  sourceTabId?: string | null
}

export type PersistenceStateEvent = {
  state: PersistenceState
  snapshot: PersistenceSnapshot
  writingId: string | null
  record?: WritingRecord
  created?: boolean
  error?: ServiceError
  diagnostics?: PersistenceDiagnostics
}

export type PersistenceDiagnostics = {
  operation: "draft-materialization" | "save"
  durationMs: number
  payloadBytes: number
}

export type PersistenceCommitEvent = {
  snapshot: PersistenceSnapshot
  record: WritingRecord
  created: boolean
  diagnostics: PersistenceDiagnostics
  /**
   * False when the document/generation this request was writing for is no
   * longer the active one (the author switched away before the write
   * finished). The write still happened — `current` only tells a listener
   * whether it's safe to reflect this record in the active editor's UI, or
   * whether it must be reconciled into background state only (ODE-478).
   */
  current: boolean
}

export type PersistenceCoordinatorDeps = {
  runtime: "desktop" | "web"
  documentService: Pick<DocumentService, "saveWriting">
  /**
   * Optional quiet window before starting a local persistence operation. The
   * editor remains fully interactive during this window; desktop uses it to
   * avoid running the filesystem → manifest → SQLite pipeline once per
   * animation frame while the author is typing.
   */
  persistenceDebounceMs?: number
  createDesktopDraft?: (options: {
    writingId?: string | null
    title?: string | null
    status?: WritingStatus
    visibility?: WritingVisibility
    initialBodyJson?: Record<string, unknown> | null
    initialBodyText?: string
  }) => Promise<ServiceResponse<WritingRecord>>
  createWritingId: () => string
  now: () => string
  nowMs?: () => number
  /**
   * Optional for adapters whose DocumentService does not schedule after its
   * durable local commit. Desktop and web production services already own
   * enqueue/schedule in their save adapter, so the editor does not call this
   * second owner and cannot duplicate a logical wakeup.
   */
  syncService?: Pick<SyncService, "scheduleFlush">
}

export type PersistenceCoordinatorEvents = {
  onStateChange?: (event: PersistenceStateEvent) => void
  onMaterialized?: (event: PersistenceCommitEvent) => void
  onIdentityCreated?: (writingId: string) => void
  onCommitted?: (event: PersistenceCommitEvent) => void
  onBackgroundCommitted?: (event: PersistenceCommitEvent) => void
  onError?: (event: PersistenceStateEvent & { operation: "draft-materialization" | "save" | "schedule" }) => void
}

export type PersistenceCoordinator = {
  persist(snapshot: PersistenceSnapshot, overrides?: PersistenceSnapshotOverrides): Promise<boolean>
  activateDocument(writingId: string | null): void
  cancel(): void
  dispose(): void
  hasPending(target?: PersistenceSettleTarget): boolean
  /**
   * Resolves once nothing is in flight, debounced or queued — flushing a
   * pending debounce immediately rather than waiting out its timer. For a
   * caller that needs to know a write has actually landed before proceeding
   * (e.g. closing a tab must not race an unsaved edit, ODE-478 case 5).
   */
  settle(target?: PersistenceSettleTarget): Promise<boolean>
}

export type PersistenceSettleTarget = {
  writingId: string | null
  draftWritingId?: string | null
  sourceTabId?: string | null
}

type PersistenceRequest = {
  snapshot: PersistenceSnapshot
  overrides?: PersistenceSnapshotOverrides
  generation: number
  key: string
  waiters: Array<(result: boolean) => void>
}

function unexpected(error: unknown): ServiceError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return error as ServiceError
  }

  return {
    code: "UNAVAILABLE",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  }
}

function errorFromResponse(response: ServiceResponse<unknown>): ServiceError | null {
  return response.error
}

/**
 * Coordinates editor persistence without coupling the editor to a runtime
 * adapter. It deliberately has one in-flight request and retains the latest
 * request for every document/tab that arrived while writes were running.
 */
export function createPersistenceCoordinator(
  deps: PersistenceCoordinatorDeps,
  events: PersistenceCoordinatorEvents = {},
): PersistenceCoordinator {
  let activeDocumentId: string | null = null
  let generation = 0
  let inFlight = false
  let disposed = false
  let inFlightRequest: PersistenceRequest | null = null
  /** The in-flight `start()` call's promise, if any. */
  let currentRun: Promise<boolean> | null = null
  /** One latest request per document/tab identity, preserving background tabs. */
  const pendingRequests = new Map<string, PersistenceRequest>()
  let scheduledKey: string | null = null
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null
  const persistenceDebounceMs = Math.max(0, deps.persistenceDebounceMs ?? 0)
  const nowMs = deps.nowMs ?? Date.now
  const materializedDrafts = new Map<string, WritingRecord>()

  const isCurrent = (request: PersistenceRequest) => !disposed && request.generation === generation

  const getRequestKey = (snapshot: PersistenceSnapshot) =>
    snapshot.writingId ?? snapshot.draftWritingId ?? snapshot.sourceTabId ?? "unidentified-document"

  const normalizeSnapshot = (snapshot: PersistenceSnapshot): PersistenceSnapshot => {
    if (snapshot.writingId || !snapshot.draftWritingId) {
      return snapshot
    }

    const materialized = materializedDrafts.get(snapshot.draftWritingId)
    if (!materialized) {
      return snapshot
    }

    return {
      ...snapshot,
      writingId: materialized.id,
      createdAt: snapshot.createdAt ?? materialized.createdAt,
      version: Math.max(snapshot.version, materialized.version),
    }
  }

  const matchesTarget = (request: PersistenceRequest, target?: PersistenceSettleTarget) => {
    if (!target) return true
    if (target.sourceTabId && request.snapshot.sourceTabId === target.sourceTabId) return true
    if (target.writingId && request.snapshot.writingId === target.writingId) return true
    if (
      target.writingId === null &&
      target.draftWritingId &&
      materializedDrafts.get(target.draftWritingId)?.id === request.snapshot.writingId
    ) {
      return true
    }
    if (
      target.writingId === null &&
      target.draftWritingId &&
      request.snapshot.writingId === null &&
      request.snapshot.draftWritingId === target.draftWritingId
    ) {
      return true
    }
    return false
  }

  const rebindMaterializedDraftRequests = (draftWritingId: string, record: WritingRecord) => {
    const rebinding = Array.from(pendingRequests.entries()).filter(
      ([, request]) => request.snapshot.writingId === null && request.snapshot.draftWritingId === draftWritingId,
    )

    rebinding.forEach(([pendingKey, request]) => {
      const nextSnapshot = {
        ...request.snapshot,
        writingId: record.id,
        createdAt: request.snapshot.createdAt ?? record.createdAt,
        version: Math.max(request.snapshot.version, record.version),
        sourceTabId: record.id,
      }
      const nextKey = getRequestKey(nextSnapshot)
      const existing = pendingRequests.get(nextKey)

      pendingRequests.delete(pendingKey)
      if (existing && existing !== request) {
        existing.snapshot = nextSnapshot
        existing.overrides = request.overrides
        existing.generation = request.generation
        existing.waiters.push(...request.waiters)
        return
      }

      request.snapshot = nextSnapshot
      request.key = nextKey
      pendingRequests.set(nextKey, request)
    })
  }

  const resolveRequest = (request: PersistenceRequest, result: boolean) => {
    const waiters = request.waiters
    request.waiters = []
    waiters.forEach((resolve) => resolve(result))
  }

  const advancePendingVersions = (record: WritingRecord) => {
    pendingRequests.forEach((request) => {
      const snapshot = request.snapshot
      const materializedId = snapshot.writingId ??
        (snapshot.draftWritingId ? materializedDrafts.get(snapshot.draftWritingId)?.id : null)
      if (materializedId !== record.id) {
        return
      }

      request.snapshot = {
        ...request.snapshot,
        createdAt: snapshot.createdAt ?? record.createdAt,
        version: Math.max(snapshot.version, record.version),
      }
    })
  }

  const findPendingEntry = (snapshot: PersistenceSnapshot, key: string) => {
    const direct = pendingRequests.get(key)
    if (direct) {
      return { key, request: direct }
    }

    if (!snapshot.writingId) {
      return null
    }

    for (const [pendingKey, request] of pendingRequests) {
      if (normalizeSnapshot(request.snapshot).writingId === snapshot.writingId) {
        return { key: pendingKey, request }
      }
    }

    return null
  }

  const emit = (
    state: PersistenceState,
    request: PersistenceRequest,
    writingId: string | null,
    record?: WritingRecord,
    error?: ServiceError,
    created?: boolean,
    diagnostics?: PersistenceDiagnostics,
  ) => {
    if (!isCurrent(request)) return
    events.onStateChange?.({ state, snapshot: request.snapshot, writingId, record, error, created, diagnostics })
  }

  const scheduleAfterCommit = async (request: PersistenceRequest, writingId: string): Promise<void> => {
    if (!deps.syncService || !isCurrent(request)) return
    try {
      const result = await deps.syncService.scheduleFlush()
      if (!result.error) return
      if (!isCurrent(request)) return

      // Local durability has already succeeded. The durable queue/ticker is
      // still authoritative; expose the scheduling issue without turning a
      // committed local edit into a local-save failure.
      events.onError?.({
        state: "queued_remote",
        snapshot: request.snapshot,
        writingId,
        error: result.error,
        operation: "schedule",
      })
    } catch (error) {
      if (!isCurrent(request)) return
      events.onError?.({
        state: "queued_remote",
        snapshot: request.snapshot,
        writingId,
        error: unexpected(error),
        operation: "schedule",
      })
    }
  }

  const persistNow = async (request: PersistenceRequest): Promise<boolean> => {
    request.snapshot = normalizeSnapshot(request.snapshot)
    request.key = getRequestKey(request.snapshot)
    const { snapshot, overrides } = request
    // A document switch (generation bump) must never stop this write from
    // reaching disk — it only means the UI-facing callbacks below get scoped
    // to `current` instead of firing unconditionally (ODE-478 case 1).
    const startedAt = nowMs()

    if (!snapshot.writingId && deps.runtime === "desktop") {
      // Desktop drafts are not durable until they carry either real content
      // or an explicit name. An empty "Untitled" with nothing typed into it
      // stays ephemeral — but naming a still-blank draft is just as
      // deliberate a signal as the first keystroke, and must materialize the
      // same way, not silently no-op (ODE-478 case 3).
      const hasExplicitTitle = Boolean(overrides?.title?.trim())
      if (snapshot.bodyText.trim() === "" && !hasExplicitTitle) {
        return true
      }

      emit("persisting_local", request, null)

      if (!deps.createDesktopDraft) {
        const error = unexpected(new Error("Desktop draft adapter is unavailable"))
        emit("failed", request, null, undefined, error)
        events.onError?.({
          state: "failed",
          snapshot,
          writingId: null,
          error,
          operation: "draft-materialization",
        })
        return false
      }

      try {
        const result = await deps.createDesktopDraft({
          writingId: snapshot.draftWritingId,
          title: overrides?.title?.trim() || snapshot.title,
          status: overrides?.status ?? snapshot.status,
          visibility: overrides?.visibility ?? snapshot.visibility,
          initialBodyJson: snapshot.bodyJson,
          initialBodyText: snapshot.bodyText,
        })

        const error = errorFromResponse(result)
        if (error || !result.data) {
          throw error ?? new Error("Failed to create desktop draft")
        }

        const materialized = result.data
        if (snapshot.draftWritingId) {
          materializedDrafts.set(snapshot.draftWritingId, materialized)
          rebindMaterializedDraftRequests(snapshot.draftWritingId, materialized)
        }
        const current = isCurrent(request)
        // Only a still-current request may reassign the coordinator's own
        // notion of "the active document" — otherwise this background write
        // would silently steal the identity the author already switched to.
        if (current) {
          activeDocumentId = materialized.id
        }
        const diagnostics: PersistenceDiagnostics = {
          operation: "draft-materialization",
          durationMs: Math.max(0, nowMs() - startedAt),
          payloadBytes: snapshot.bodyText.length,
        }
        const commit = { snapshot, record: materialized, created: true, diagnostics, current }
        // Fires unconditionally: a file was just written for this snapshot
        // and something must own reconciling it into the tab/session store,
        // even when the author is no longer looking at it (ODE-478 case 4 —
        // the alternative is an orphaned file no tab ever points to).
        events.onMaterialized?.(commit)
        if (current) {
          await scheduleAfterCommit(request, materialized.id)
          events.onCommitted?.(commit)
          emit("queued_remote", request, materialized.id, materialized, undefined, true, diagnostics)
        }
        return true
      } catch (error) {
        const serviceError = unexpected(error)
        emit("failed", request, null, undefined, serviceError)
        events.onError?.({
          state: "failed",
          snapshot,
          writingId: null,
          error: serviceError,
          operation: "draft-materialization",
        })
        return false
      }
    }

    emit("persisting_local", request, snapshot.writingId)

    let writingId = snapshot.writingId
    if (!writingId) {
      writingId = deps.createWritingId()
      if (isCurrent(request)) {
        activeDocumentId = writingId
        events.onIdentityCreated?.(writingId)
      }
    }

    const nowIso = deps.now()
    const record: WritingRecord = {
      id: writingId,
      authorId: null,
      title: overrides?.title?.trim() || snapshot.title,
      content: {
        richText: snapshot.bodyJson,
        markdown: null,
        plainText: snapshot.bodyText,
        canonicalSource: "rich-text",
      },
      slug: null,
      status: overrides?.status ?? snapshot.status,
      artifactType: overrides?.artifactType ?? snapshot.artifactType,
      visibility: overrides?.visibility ?? snapshot.visibility,
      parentId: null,
      correspondenceId: null,
      version: snapshot.version + 1,
      deletedAt: null,
      createdAt: snapshot.createdAt ?? nowIso,
      updatedAt: nowIso,
      contentUpdatedAt: nowIso,
      metadataUpdatedAt: nowIso,
      lifecycle: snapshot.lifecycle,
    }

    try {
      const result = await deps.documentService.saveWriting({ writing: record })
      const error = errorFromResponse(result)
      if (error || !result.data) {
        throw error ?? new Error("Failed to save writing")
      }

      const savedRecord = result.data
      const current = isCurrent(request)
      advancePendingVersions(savedRecord)
      const diagnostics: PersistenceDiagnostics = {
        operation: "save",
        durationMs: Math.max(0, nowMs() - startedAt),
        payloadBytes: snapshot.bodyText.length,
      }
      const commit = { snapshot, record: savedRecord, created: snapshot.writingId === null, diagnostics, current }
      if (current) {
        await scheduleAfterCommit(request, savedRecord.id)
      }
      if (current) {
        events.onCommitted?.(commit)
      } else {
        events.onBackgroundCommitted?.(commit)
      }
      if (current) {
        emit("queued_remote", request, savedRecord.id, savedRecord, undefined, false, diagnostics)
      }
      return true
    } catch (error) {
      const serviceError = unexpected(error)
      emit("failed", request, writingId, undefined, serviceError)
      events.onError?.({
        state: "failed",
        snapshot,
        writingId,
        error: serviceError,
        operation: "save",
      })
      return false
    }
  }

  const armSchedule = (key: string) => {
    if (scheduledTimer !== null) {
      clearTimeout(scheduledTimer)
    }

    scheduledKey = key
    if (disposed || persistenceDebounceMs <= 0) {
      scheduledKey = null
      const request = pendingRequests.get(key)
      if (request) {
        pendingRequests.delete(key)
        void start(request)
      }
      return
    }

    scheduledTimer = setTimeout(() => {
      scheduledTimer = null
      scheduledKey = null
      const request = pendingRequests.get(key)
      if (!request) {
        pump()
        return
      }
      pendingRequests.delete(key)
      void start(request)
    }, persistenceDebounceMs)
  }

  const pump = () => {
    if (inFlight || scheduledKey !== null) {
      return
    }

    const next = pendingRequests.entries().next()
    if (next.done) {
      return
    }

    const [key, request] = next.value
    if (persistenceDebounceMs > 0 && !disposed) {
      armSchedule(key)
      return
    }

    pendingRequests.delete(key)
    void start(request)
  }

  const start = (request: PersistenceRequest): Promise<boolean> => {
    inFlight = true
    inFlightRequest = request
    const run = persistNow(request)
      .catch((error) => {
        const serviceError = unexpected(error)
        emit("failed", request, request.snapshot.writingId, undefined, serviceError)
        events.onError?.({
          state: "failed",
          snapshot: request.snapshot,
          writingId: request.snapshot.writingId,
          error: serviceError,
          operation: request.snapshot.writingId ? "save" : "draft-materialization",
        })
        return false
      })
      .then((result) => {
        // `start()` returns the durable result for internal callers such as
        // `settle()`. Public `persist()` callers retain the historical
        // generation-scoped result: a write completed after cancellation is
        // durable, but no longer belongs to the active editor generation.
        resolveRequest(request, result && isCurrent(request))
        return result
      })
      .finally(() => {
        inFlight = false
        inFlightRequest = null
        currentRun = null
        pump()
      })
    currentRun = run
    return run
  }

  const flushScheduled = (targetKey?: string): Promise<boolean> => {
    if (inFlight && currentRun) {
      return currentRun
    }

    const key = targetKey ?? scheduledKey
    if (!key) {
      return Promise.resolve(true)
    }

    if (scheduledTimer !== null) {
      clearTimeout(scheduledTimer)
      scheduledTimer = null
    }
    scheduledKey = null

    const request = pendingRequests.get(key)
    if (!request) {
      pump()
      return Promise.resolve(true)
    }

    pendingRequests.delete(key)
    return start(request)
  }

  const hasPendingFor = (target?: PersistenceSettleTarget) => {
    if (!target) {
      return inFlight || scheduledKey !== null || pendingRequests.size > 0
    }

    return Boolean(
      (inFlightRequest && matchesTarget(inFlightRequest, target)) ||
      Array.from(pendingRequests.values()).some((request) => matchesTarget(request, target)),
    )
  }

  const findPending = (target: PersistenceSettleTarget) => {
    for (const [key, request] of pendingRequests) {
      if (matchesTarget(request, target)) {
        return { key, request }
      }
    }

    return null
  }

  const flushPending = (target: PersistenceSettleTarget): Promise<boolean> => {
    if (inFlight && currentRun) {
      return currentRun
    }

    const pending = findPending(target)
    if (!pending) {
      pump()
      return Promise.resolve(true)
    }

    if (scheduledTimer !== null) {
      clearTimeout(scheduledTimer)
      scheduledTimer = null
    }
    scheduledKey = null
    pendingRequests.delete(pending.key)
    return start(pending.request)
  }

  const settle = async (target?: PersistenceSettleTarget): Promise<boolean> => {
    let succeeded = true
    while (hasPendingFor(target)) {
      if (target && !inFlight) {
        const result = await flushPending(target)
        succeeded = succeeded && result
        continue
      }

      if (!target && scheduledKey !== null && !inFlight) {
        const result = await flushScheduled()
        succeeded = succeeded && result
        continue
      }

      if (inFlight && currentRun) {
        const request = inFlightRequest
        const result = await currentRun
        if (!target || (request && matchesTarget(request, target))) {
          succeeded = succeeded && result
        }
        continue
      }

      pump()
      if (!inFlight && scheduledKey === null && pendingRequests.size === 0) {
        break
      }
    }

    return succeeded
  }

  return {
    persist(snapshot, overrides) {
      if (disposed) return Promise.resolve(false)

      const normalizedSnapshot = normalizeSnapshot(snapshot)

      // A snapshot is the caller's explicit document identity. If that
      // identity differs, invalidate the previous document's completion
      // before accepting the new request.
      if (normalizedSnapshot.writingId !== activeDocumentId) {
        // A tab switch or first materialization can race this state update. The
        // canonical `.md` for the previous document must still be written; the
        // generation change only suppresses its UI completion callbacks.
        void flushScheduled()
        activeDocumentId = normalizedSnapshot.writingId
        generation += 1
      }

      const key = getRequestKey(normalizedSnapshot)

      if (inFlight) {
        const pending = findPendingEntry(normalizedSnapshot, key)
        if (pending) {
          pending.request.snapshot = normalizedSnapshot
          pending.request.overrides = overrides
          pending.request.generation = generation
        } else {
          pendingRequests.set(key, {
            snapshot: normalizedSnapshot,
            overrides,
            generation,
            key,
            waiters: [],
          })
        }

        events.onStateChange?.({ state: "dirty", snapshot: normalizedSnapshot, writingId: normalizedSnapshot.writingId })
        return Promise.resolve(true)
      }

      return new Promise((resolve) => {
        const pending = findPendingEntry(normalizedSnapshot, key)
        if (pending) {
          pending.request.snapshot = normalizedSnapshot
          pending.request.overrides = overrides
          pending.request.generation = generation
          pending.request.waiters.push(resolve)
        } else {
          pendingRequests.set(key, {
            snapshot: normalizedSnapshot,
            overrides,
            generation,
            key,
            waiters: [resolve],
          })
        }

        if (scheduledKey === key) {
          armSchedule(key)
          return
        }

        pump()
      })
    },

    activateDocument(writingId) {
      if (disposed || writingId === activeDocumentId) return
      void flushScheduled()
      activeDocumentId = writingId
      generation += 1
    },

    cancel() {
      if (disposed) return
      void flushScheduled()
      generation += 1
    },

    dispose() {
      if (disposed) return
      void flushScheduled()
      disposed = true
      generation += 1
    },

    hasPending: hasPendingFor,
    settle,
  }
}
