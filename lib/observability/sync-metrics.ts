export type SyncRuntime = "desktop" | "web"
export type SyncQueue = "sqlite" | "indexeddb"
export type SyncFlushTrigger = "post_commit" | "debounce" | "retry_tick" | "bootstrap" | "auth" | "explicit"
type Base = { schemaVersion: 1; timestamp: string; runtime: SyncRuntime; queue: SyncQueue }
export type SyncFlushMetric = Base & { type: "sync.flush"; trigger: SyncFlushTrigger; examined: number; sent: number; superseded: number; succeeded: number; failed: number; cloudBytes: number; verifiedWrites: number; durationMs: number; overlapDetected: boolean; queueWaitMs: number[] }
export type SyncCloudWriteMetric = Base & { type: "sync.cloud_write"; operation: "insert" | "update" | "delete" | "upsert" | "replace_relations" | "request"; bytes: number; affectedRows: number | null; durationMs: number; outcome: "success" | "failure" }
export type SyncMetric = SyncFlushMetric | SyncCloudWriteMetric
let sink: (metric: SyncMetric) => void = (metric) => console.info("[sync:metrics]", JSON.stringify(metric))
export function setSyncMetricSink(next: ((metric: SyncMetric) => void) | null) { sink = next ?? (() => undefined) }
export function serializedBytes(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return 0 } }
export function emitSyncMetric(metric: SyncMetric): void {
  try {
    if (typeof window !== "undefined") {
      const target = window as typeof window & { __ODESSAY_SYNC_METRICS__?: SyncMetric[] }
      const metrics = target.__ODESSAY_SYNC_METRICS__ ??= []
      metrics.push(metric)
      if (metrics.length > 500) metrics.splice(0, metrics.length - 500)
    }
    sink(metric)
  } catch { /* fail open */ }
}
export function metricBase(runtime: SyncRuntime, queue: SyncQueue): Base { return { schemaVersion: 1, timestamp: new Date().toISOString(), runtime, queue } }
export type SyncBaseline = { runtime: SyncRuntime; queue: SyncQueue; flushes: number; syncsPerUserHour: number; kbPerSync: number; writesPerSync: number; durationP95Ms: number; queueWaitP50Ms: number; queueWaitP95Ms: number }
function percentile(values: number[], fraction: number): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0 }
export function aggregateSyncMetrics(metrics: readonly SyncMetric[], sessionHours = 1): SyncBaseline[] {
  const groups = new Map<string, SyncFlushMetric[]>()
  for (const metric of metrics) { if (metric.type !== "sync.flush" || metric.sent === 0) continue; const key = `${metric.runtime}:${metric.queue}`; groups.set(key, [...(groups.get(key) ?? []), metric]) }
  return [...groups.values()].map((flushes) => { const first = flushes[0]!; const waits = flushes.flatMap((metric) => metric.queueWaitMs); return { runtime: first.runtime, queue: first.queue, flushes: flushes.length, syncsPerUserHour: flushes.length / Math.max(sessionHours, 1 / 3600), kbPerSync: flushes.reduce((sum, metric) => sum + metric.cloudBytes, 0) / flushes.length / 1024, writesPerSync: flushes.reduce((sum, metric) => sum + metric.verifiedWrites, 0) / flushes.length, durationP95Ms: percentile(flushes.map((metric) => metric.durationMs), .95), queueWaitP50Ms: percentile(waits, .5), queueWaitP95Ms: percentile(waits, .95) } })
}
