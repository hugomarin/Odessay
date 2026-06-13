import type {
  EnqueueSyncMutationInput,
  FlushSyncResult,
  HydrateCollectionsResult,
  HydrateWritingInput,
  HydrateWritingResult,
  HydrateWritingsResult,
  QuerySyncStatusInput,
  SyncMutation as ContractSyncMutation,
  SyncQueueReceipt,
  SyncRuntimeState,
  SyncService,
  SyncStatus,
} from "@/lib/services/contracts/sync-service"
import type {
  ServiceErrorCode,
  ServiceResponse,
} from "@/lib/services/contracts/service-types"
import { createEntityKey, localDB } from "@/lib/local-db"
import type {
  RemoteCollectionPayload,
  RemoteWritingCollectionsPayload,
  RemoteWritingPayload,
  SyncMutation as LocalSyncMutation,
  WritingStatus,
  WritingVisibility,
} from "@/lib/local-db/schema"
import { emitSyncStatusChange } from "@/lib/sync/events"
import { hydrateLocalCollectionsFromRemote } from "@/lib/collections/remote-bootstrap"
import {
  hydrateLocalWritingFromRemote,
  hydrateLocalWritingsFromRemote,
} from "@/lib/sync/remote-bootstrap"
import { getSyncWorker } from "@/lib/sync/worker"

const EMPTY_BODY_JSON: Record<string, unknown> = {
  type: "doc",
  content: [],
}

const mapWritingPayload = (
  payload: Extract<ContractSyncMutation, { entityKind: "writing" }>["payload"],
): RemoteWritingPayload => ({
  author_id: null,
  title: payload.title,
  body_json: payload.bodyJson ?? EMPTY_BODY_JSON,
  body_text: payload.bodyText,
  slug: payload.slug,
  status: payload.status as WritingStatus,
  artifact_type: payload.artifactType,
  visibility: payload.visibility as WritingVisibility,
  parent_id: payload.parentId,
  correspondence_id: payload.correspondenceId,
  version: payload.version,
  updated_at: payload.updatedAt,
  deleted_at: payload.deletedAt,
})

const mapCollectionPayload = (
  payload: Extract<ContractSyncMutation, { entityKind: "collection" }>["payload"],
): RemoteCollectionPayload => ({
  owner_id: null,
  name: payload.name,
  description: payload.description,
  visibility: payload.visibility,
  updated_at: payload.updatedAt,
})

const mapWritingCollectionsPayload = (
  payload: Extract<
    ContractSyncMutation,
    { entityKind: "writing-collections" }
  >["payload"],
): RemoteWritingCollectionsPayload => ({
  collection_ids: payload.collectionIds,
  updated_at: payload.updatedAt,
})

const toLocalSyncMutation = (mutation: ContractSyncMutation): LocalSyncMutation => {
  if (mutation.entityKind === "correction-block") {
    throw new Error("Unsupported entity kind: correction-block")
  }

  const base = {
    id: mutation.id,
    entity_id: mutation.entityId,
    entity_key: createEntityKey(mutation.entityKind, mutation.entityId),
    operation: mutation.operation,
    created_at: mutation.createdAt,
    attempts: mutation.attempts,
  }

  if (mutation.entityKind === "writing") {
    return {
      ...base,
      entity_kind: "writing",
      operation: mutation.operation,
      payload: mapWritingPayload(mutation.payload),
    }
  }

  if (mutation.entityKind === "collection") {
    return {
      ...base,
      entity_kind: "collection",
      operation: mutation.operation,
      payload: mapCollectionPayload(mutation.payload),
    }
  }

  if (mutation.entityKind === "writing-collections") {
    return {
      ...base,
      entity_kind: "writing-collections",
      operation: "set",
      payload: mapWritingCollectionsPayload(mutation.payload),
    }
  }

  throw new Error(`Unsupported entity kind: ${(mutation as ContractSyncMutation).entityKind}`)
}

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(
  code: ServiceErrorCode,
  message: string,
  retryable = false,
): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable } }
}

export const webSyncService: SyncService = {
  async enqueueMutation(
    input: EnqueueSyncMutationInput,
  ): Promise<ServiceResponse<SyncQueueReceipt>> {
    try {
      const localMutation = toLocalSyncMutation(input.mutation)
      await localDB.syncQueue.enqueue(localMutation)

      if (localMutation.entity_kind === "writing") {
        emitSyncStatusChange({
          writingId: localMutation.entity_id,
          status: "pending",
        })
      }

      getSyncWorker().schedule(0)

      return ok({
        accepted: true,
        mutationId: localMutation.id,
        entityKind: localMutation.entity_kind,
        entityId: localMutation.entity_id,
      })
    } catch (error) {
      return err(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Failed to enqueue mutation",
      )
    }
  },

  async hydrateWritings(): Promise<ServiceResponse<HydrateWritingsResult>> {
    try {
      const appliedCount = await hydrateLocalWritingsFromRemote()
      return ok({ appliedCount, hydratedIds: [] })
    } catch (error) {
      return err(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Hydration failed",
      )
    }
  },

  async hydrateWriting(
    input: HydrateWritingInput,
  ): Promise<ServiceResponse<HydrateWritingResult>> {
    try {
      const hydrated = await hydrateLocalWritingFromRemote(input.writingId)
      return ok({ hydrated, writingId: input.writingId })
    } catch (error) {
      return err(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Hydration failed",
      )
    }
  },

  async hydrateCollections(): Promise<ServiceResponse<HydrateCollectionsResult>> {
    try {
      const result = await hydrateLocalCollectionsFromRemote()
      return ok({ appliedCount: result.collections.length })
    } catch (error) {
      return err(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Collection hydration failed",
      )
    }
  },

  async flushPending(): Promise<ServiceResponse<FlushSyncResult>> {
    try {
      const beforePending = await localDB.syncQueue.getPending()
      await getSyncWorker().flush()
      const afterPending = await localDB.syncQueue.getPending()
      const processed = beforePending.length - afterPending.length
      const failed = afterPending.filter((m) => m.attempts > 0).map((m) => m.id)
      const nextRetry =
        afterPending.length > 0
          ? Math.min(
              ...afterPending.map((m) => m.next_retry_at ?? Number.MAX_SAFE_INTEGER),
            )
          : null

      return ok({
        processedMutations: Math.max(0, processed),
        failedMutations: failed,
        nextRetryAt: nextRetry === Number.MAX_SAFE_INTEGER ? null : nextRetry,
      })
    } catch (error) {
      return err(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Flush failed",
      )
    }
  },

  async scheduleFlush(): Promise<ServiceResponse<void>> {
    try {
      getSyncWorker().schedule(0)
      return ok(undefined)
    } catch (error) {
      return err(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Schedule failed",
      )
    }
  },

  async start(): Promise<ServiceResponse<void>> {
    try {
      getSyncWorker().start()
      return ok(undefined)
    } catch (error) {
      return err(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Start failed",
      )
    }
  },

  async stop(): Promise<ServiceResponse<void>> {
    try {
      getSyncWorker().stop()
      return ok(undefined)
    } catch (error) {
      return err(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Stop failed",
      )
    }
  },

  async getRuntimeState(
    input?: QuerySyncStatusInput,
  ): Promise<ServiceResponse<SyncRuntimeState>> {
    try {
      const pending = await localDB.syncQueue.getPending()
      const pendingCount = pending.length

      let nextRetryAt: number | null = null
      if (pending.length > 0) {
        const retryTimes = pending
          .map((m) => m.next_retry_at)
          .filter((t): t is number => t !== undefined && t !== null)
        if (retryTimes.length > 0) {
          nextRetryAt = Math.min(...retryTimes)
        }
      }

      let status: SyncStatus = pendingCount > 0 ? "pending" : "idle"

      if (input?.writingId) {
        const writing = await localDB.writings.get(input.writingId)
        const writingPending = pending.some(
          (m) => m.entity_kind === "writing" && m.entity_id === input.writingId,
        )

        if (writing?.sync_status === "synced" || writing?.sync_status === "deleted") {
          status = "synced"
        } else if (writing?.sync_status === "failed") {
          status = "failed"
        } else if (writingPending) {
          status = "pending"
        } else {
          status = "idle"
        }
      }

      return ok({
        status,
        pendingMutations: pendingCount,
        nextRetryAt,
        lastSyncedAt: null,
      })
    } catch (error) {
      return err(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "Status query failed",
      )
    }
  },
}
