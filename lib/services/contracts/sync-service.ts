import {
  PHASE_4_REQUIRED_DOCS,
  SERVICE_RESPONSE_ENVELOPE,
  type ServiceContractDescriptor,
  type ServiceResponse,
} from "./service-types"

export type SyncEntityKind = "writing" | "collection" | "writing-collections" | "correction-block"
export type SyncOperation = "upsert" | "delete" | "set"
export type SyncStatus = "idle" | "pending" | "syncing" | "synced" | "failed" | "offline"

export type SyncableWritingPayload = {
  title: string | null
  bodyText: string
  bodyJson: Record<string, unknown> | null
  slug: string | null
  status: string
  visibility: "private" | "shared" | "public"
  parentId: string | null
  correspondenceId: string | null
  version: number
  updatedAt: string
  deletedAt: string | null
}

export type SyncableCollectionPayload = {
  name: string
  description: string | null
  visibility: "private" | "public"
  updatedAt: string
}

export type SyncableWritingCollectionsPayload = {
  collectionIds: string[]
  updatedAt: string
}

export type SyncMutation =
  | {
      id: string
      entityKind: "writing"
      entityId: string
      operation: "upsert" | "delete"
      createdAt: number
      attempts: number
      payload: SyncableWritingPayload
    }
  | {
      id: string
      entityKind: "collection"
      entityId: string
      operation: "upsert" | "delete"
      createdAt: number
      attempts: number
      payload: SyncableCollectionPayload
    }
  | {
      id: string
      entityKind: "writing-collections"
      entityId: string
      operation: "set"
      createdAt: number
      attempts: number
      payload: SyncableWritingCollectionsPayload
    }
  | {
      id: string
      entityKind: "correction-block"
      entityId: string
      operation: "upsert" | "delete"
      createdAt: number
      attempts: number
      payload: Record<string, unknown>
    }

export type EnqueueSyncMutationInput = {
  mutation: SyncMutation
}

export type SyncQueueReceipt = {
  accepted: boolean
  mutationId: string
  entityKind: SyncEntityKind
  entityId: string
}

export type HydrateWritingsResult = {
  appliedCount: number
  hydratedIds: string[]
}

export type HydrateWritingInput = {
  writingId: string
}

export type HydrateWritingResult = {
  hydrated: boolean
  writingId: string
}

export type FlushSyncResult = {
  processedMutations: number
  failedMutations: string[]
  nextRetryAt: number | null
}

export type HydrateCollectionsResult = {
  appliedCount: number
}

export type QuerySyncStatusInput = {
  writingId?: string
}

export type SyncRuntimeState = {
  status: SyncStatus
  pendingMutations: number
  nextRetryAt: number | null
  lastSyncedAt: string | null
}

export interface SyncService {
  enqueueMutation(input: EnqueueSyncMutationInput): Promise<ServiceResponse<SyncQueueReceipt>>
  hydrateWritings(): Promise<ServiceResponse<HydrateWritingsResult>>
  hydrateWriting(input: HydrateWritingInput): Promise<ServiceResponse<HydrateWritingResult>>
  hydrateCollections(): Promise<ServiceResponse<HydrateCollectionsResult>>
  flushPending(): Promise<ServiceResponse<FlushSyncResult>>
  scheduleFlush(): Promise<ServiceResponse<void>>
  start(): Promise<ServiceResponse<void>>
  stop(): Promise<ServiceResponse<void>>
  getRuntimeState(input?: QuerySyncStatusInput): Promise<ServiceResponse<SyncRuntimeState>>
}

export const SYNC_SERVICE_CONTRACT = {
  name: "SyncService",
  summary:
    "Application boundary for enqueueing mutations, hydrating local state, and flushing retries without tying sync semantics to fetch, browser listeners, or the current Next transport.",
  responsibilities: [
    "Make queue, retry, and hydration explicit product capabilities instead of browser-only helpers.",
    "Separate sync scheduling semantics from the concrete transport used by the current web runtime.",
    "Expose enough status for UI and diagnostics without leaking worker implementation details.",
  ],
  layer: ["application", "adapter"],
  runtimeScope: ["shared-core", "web", "desktop", "cloud"],
  owner: "architecture-first",
  invariants: [
    "SyncService owns mutation orchestration and hydration semantics, not the UI layer.",
    "Queueing and retry metadata are contract-level concerns; fetch, window, navigator, and Supabase details are adapter concerns.",
    "Hydration can target full indexes or single writings, but the caller must not know which web endpoint or local cache implementation serves that request.",
  ],
  errorEnvelope: SERVICE_RESPONSE_ENVELOPE,
  operations: [
    {
      name: "enqueueMutation",
      kind: "command",
      summary: "Accept a sync mutation into the durable queue boundary.",
      input: ["SyncMutation"],
      output: ["SyncQueueReceipt"],
      errorCodes: ["INVALID_INPUT", "UNAVAILABLE", "UNKNOWN"],
    },
    {
      name: "hydrateWritings",
      kind: "query",
      summary: "Hydrate local index state from the active remote adapter without exposing endpoint details.",
      input: ["none"],
      output: ["HydrateWritingsResult"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "hydrateWriting",
      kind: "query",
      summary: "Hydrate a single writing body when local state lacks the necessary content.",
      input: ["writingId"],
      output: ["HydrateWritingResult"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "UNAVAILABLE"],
    },
    {
      name: "hydrateCollections",
      kind: "query",
      summary: "Hydrate local collections and writing-collection assignments from the active remote adapter.",
      input: ["none"],
      output: ["HydrateCollectionsResult"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "flushPending",
      kind: "command",
      summary: "Process pending mutations according to adapter availability and retry policy.",
      input: ["none"],
      output: ["FlushSyncResult"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "RATE_LIMITED", "TIMEOUT", "UNAVAILABLE"],
    },
    {
      name: "scheduleFlush",
      kind: "command",
      summary: "Request a deferred flush of pending mutations without awaiting completion.",
      input: ["none"],
      output: ["void"],
      errorCodes: ["UNAVAILABLE"],
    },
    {
      name: "start",
      kind: "command",
      summary: "Start the sync worker and online listeners for the active runtime adapter.",
      input: ["none"],
      output: ["void"],
      errorCodes: ["UNAVAILABLE"],
    },
    {
      name: "stop",
      kind: "command",
      summary: "Stop the sync worker and online listeners for the active runtime adapter.",
      input: ["none"],
      output: ["void"],
      errorCodes: ["UNAVAILABLE"],
    },
    {
      name: "getRuntimeState",
      kind: "query",
      summary: "Expose queue and retry state without leaking event emitter or worker wiring.",
      input: ["optional writingId"],
      output: ["SyncRuntimeState"],
      errorCodes: ["UNAVAILABLE", "UNKNOWN"],
    },
  ],
  hotspots: [
    {
      id: "browser-sync-worker",
      summary: "Queue flush and retry logic currently depend on browser timers, online listeners, and direct HTTP transport.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "lib/sync/worker.ts",
        "lib/sync/queue.ts",
        "lib/sync/retry.ts",
      ],
    },
    {
      id: "remote-hydration-bootstrap",
      summary: "Hydration flows are already explicit but remain hardwired to /api routes and web payload shapes.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "shared-core", "cloud"],
      owner: "architecture-first",
      currentEntrypoints: [
        "lib/sync/remote-bootstrap.ts",
        "lib/collections/remote-bootstrap.ts",
      ],
    },
    {
      id: "ui-driven-sync-startup",
      summary: "Sync lifecycle still starts from UI/runtime wiring instead of an adapter-agnostic capability boundary.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "components/editor/editor-shell.tsx",
        "lib/sync/events.ts",
      ],
    },
  ],
  requiredDocs: [...PHASE_4_REQUIRED_DOCS],
} satisfies ServiceContractDescriptor<"SyncService", keyof SyncService>
