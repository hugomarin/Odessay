type CorrectionQueueEnqueueEvent = {
  type: "queue:enqueue"
  blockId: string
  reason: "edit" | "hydrate-miss"
}

type CorrectionQueueFlushEvent = {
  type: "queue:flush"
  batchSize: number
  blockIds: string[]
}

type CorrectionRequestStartEvent = {
  type: "request:start"
  batchId: string
  blockIds: string[]
}

type CorrectionRequestEndEvent = {
  type: "request:end"
  batchId: string
  latencyMs: number
  suggestions: number
  missing: string[]
}

type CorrectionCacheHitEvent = {
  type: "cache:hit"
  blockId: string
  source: "memory" | "idb" | "supabase"
}

type CorrectionCacheMissEvent = {
  type: "cache:miss"
  blockId: string
}

type CorrectionStaleKeepEvent = {
  type: "stale:keep"
  blockId: string
  suggestionId: string
}

type CorrectionStaleDropEvent = {
  type: "stale:drop"
  blockId: string
  suggestionId: string
}

export type CorrectionEvent =
  | CorrectionQueueEnqueueEvent
  | CorrectionQueueFlushEvent
  | CorrectionRequestStartEvent
  | CorrectionRequestEndEvent
  | CorrectionCacheHitEvent
  | CorrectionCacheMissEvent
  | CorrectionStaleKeepEvent
  | CorrectionStaleDropEvent

const isProduction = process.env.NODE_ENV === "production"

export const logCorrectionEvent = (event: CorrectionEvent) => {
  if (isProduction) {
    return
  }

  console.debug("[corrections]", event)
}
