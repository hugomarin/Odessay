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
}

export type PersistenceCoordinatorDeps = {
  runtime: "desktop" | "web"
  documentService: Pick<DocumentService, "saveWriting">
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
  onError?: (event: PersistenceStateEvent & { operation: "draft-materialization" | "save" | "schedule" }) => void
}

export type PersistenceCoordinator = {
  persist(snapshot: PersistenceSnapshot, overrides?: PersistenceSnapshotOverrides): Promise<boolean>
  activateDocument(writingId: string | null): void
  cancel(): void
  dispose(): void
}

type PersistenceRequest = {
  snapshot: PersistenceSnapshot
  overrides?: PersistenceSnapshotOverrides
  generation: number
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
 * adapter. It deliberately has one in-flight request and retains only the
 * latest request that arrived while that request was running.
 */
export function createPersistenceCoordinator(
  deps: PersistenceCoordinatorDeps,
  events: PersistenceCoordinatorEvents = {},
): PersistenceCoordinator {
  let activeDocumentId: string | null = null
  let generation = 0
  let inFlight = false
  let queued: PersistenceRequest | null = null
  let disposed = false
  let activeRecord: WritingRecord | null = null
  const nowMs = deps.nowMs ?? Date.now

  const isCurrent = (request: PersistenceRequest) => !disposed && request.generation === generation

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
    const { snapshot, overrides } = request
    if (!isCurrent(request)) return false
    const startedAt = nowMs()

    if (!snapshot.writingId && deps.runtime === "desktop") {
      // Desktop drafts are not durable until they contain real content.
      if (snapshot.bodyText.trim() === "") {
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
        if (!isCurrent(request)) return false

        const error = errorFromResponse(result)
        if (error || !result.data) {
          throw error ?? new Error("Failed to create desktop draft")
        }

        const materialized = result.data
        activeDocumentId = materialized.id
        activeRecord = materialized
        const diagnostics: PersistenceDiagnostics = {
          operation: "draft-materialization",
          durationMs: Math.max(0, nowMs() - startedAt),
          payloadBytes: snapshot.bodyText.length,
        }
        const commit = { snapshot, record: materialized, created: true, diagnostics }
        events.onMaterialized?.(commit)
        await scheduleAfterCommit(request, materialized.id)
        if (!isCurrent(request)) return false
        events.onCommitted?.(commit)
        emit("queued_remote", request, materialized.id, materialized, undefined, true, diagnostics)
        return true
      } catch (error) {
        if (!isCurrent(request)) return false
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
      activeDocumentId = writingId
      if (isCurrent(request)) events.onIdentityCreated?.(writingId)
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
      if (!isCurrent(request)) return false

      const error = errorFromResponse(result)
      if (error || !result.data) {
        throw error ?? new Error("Failed to save writing")
      }

      const savedRecord = result.data
      activeRecord = savedRecord
      const diagnostics: PersistenceDiagnostics = {
        operation: "save",
        durationMs: Math.max(0, nowMs() - startedAt),
        payloadBytes: snapshot.bodyText.length,
      }
      const commit = { snapshot, record: savedRecord, created: snapshot.writingId === null, diagnostics }
      await scheduleAfterCommit(request, savedRecord.id)
      if (!isCurrent(request)) return false
      events.onCommitted?.(commit)
      emit("queued_remote", request, savedRecord.id, savedRecord, undefined, false, diagnostics)
      return true
    } catch (error) {
      if (!isCurrent(request)) return false
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

  const start = (request: PersistenceRequest): Promise<boolean> => {
    inFlight = true
    return persistNow(request).finally(() => {
      inFlight = false
      if (disposed) return

      const next = queued
      queued = null
      const continuation = next && activeDocumentId
        ? next.snapshot.writingId === null
          ? {
              ...next,
              snapshot: {
                ...next.snapshot,
                writingId: activeDocumentId,
                createdAt: activeRecord?.createdAt ?? next.snapshot.createdAt,
                version: activeRecord?.version ?? next.snapshot.version,
              },
            }
          : activeRecord
            ? {
                ...next,
                snapshot: {
                  ...next.snapshot,
                  createdAt: activeRecord.createdAt,
                  version: activeRecord.version,
                },
              }
            : next
        : next
      if (continuation && isCurrent(continuation)) {
        void start(continuation)
      }
    })
  }

  return {
    persist(snapshot, overrides) {
      if (disposed) return Promise.resolve(false)

      // A snapshot is the caller's explicit document identity. If that
      // identity differs, invalidate the previous document's completion
      // before accepting the new request.
      if (snapshot.writingId !== activeDocumentId) {
        activeDocumentId = snapshot.writingId
        activeRecord = null
        generation += 1
        queued = null
      }

      const request = { snapshot, overrides, generation }
      if (inFlight) {
        queued = request
        events.onStateChange?.({ state: "dirty", snapshot, writingId: snapshot.writingId })
        return Promise.resolve(true)
      }

      return start(request)
    },

    activateDocument(writingId) {
      if (disposed || writingId === activeDocumentId) return
      activeDocumentId = writingId
      activeRecord = null
      generation += 1
      queued = null
    },

    cancel() {
      if (disposed) return
      generation += 1
      activeRecord = null
      queued = null
    },

    dispose() {
      if (disposed) return
      disposed = true
      generation += 1
      activeRecord = null
      queued = null
    },
  }
}
