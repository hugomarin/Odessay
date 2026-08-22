import { readFileSync, writeFileSync } from "node:fs"

const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) {
  console.error("Usage: node scripts/report-sync-metrics.mjs <metrics.jsonl> <report.json>")
  process.exit(1)
}

const metrics = readFileSync(input, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
const allowed = new Set(["schemaVersion", "timestamp", "runtime", "queue", "type", "trigger", "examined", "sent", "superseded", "succeeded", "failed", "cloudBytes", "verifiedWrites", "durationMs", "overlapDetected", "queueWaitMs", "operation", "bytes", "affectedRows", "outcome"])
for (const metric of metrics) {
  for (const key of Object.keys(metric)) if (!allowed.has(key)) throw new Error(`Unsafe metric key: ${key}`)
}
const percentile = (values, fraction) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}
const groups = new Map()
const timestamps = metrics.map((metric) => Date.parse(metric.timestamp)).filter(Number.isFinite)
const sessionHours = Math.max(1 / 3600, ((Math.max(...timestamps) || 0) - (Math.min(...timestamps) || 0)) / 3_600_000)
for (const metric of metrics) {
  if (metric.type !== "sync.flush" || metric.sent === 0) continue
  const key = `${metric.runtime}:${metric.queue}`
  groups.set(key, [...(groups.get(key) ?? []), metric])
}
const report = [...groups.values()].map((flushes) => {
  const waits = flushes.flatMap((metric) => metric.queueWaitMs)
  return { runtime: flushes[0].runtime, queue: flushes[0].queue, flushes: flushes.length, syncsPerUserHour: flushes.length / sessionHours, kbPerSync: flushes.reduce((sum, metric) => sum + metric.cloudBytes, 0) / flushes.length / 1024, writesPerSync: flushes.reduce((sum, metric) => sum + metric.verifiedWrites, 0) / flushes.length, durationP95Ms: percentile(flushes.map((metric) => metric.durationMs), .95), queueWaitP50Ms: percentile(waits, .5), queueWaitP95Ms: percentile(waits, .95) }
})
writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), series: report }, null, 2)}\n`)
