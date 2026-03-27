#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

function fail(message) {
  console.error(`[analyze-editor-trace] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 1) {
    fail("Usage: node scripts/analyze-editor-trace.mjs <trace.json|trace.json.gz>");
  }
  return {
    tracePath: args[0],
  };
}

function readTrace(path) {
  const buffer = readFileSync(path);
  const isGzip = path.endsWith(".gz");
  const raw = isGzip ? gunzipSync(buffer) : buffer;
  const parsed = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(parsed.traceEvents)) {
    fail("Invalid trace file: missing traceEvents[]");
  }
  return parsed.traceEvents;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function maxOf(values) {
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value > max) max = value;
  }
  return max;
}

function stats(values) {
  if (values.length === 0) return null;
  return {
    count: values.length,
    p50: Number(percentile(values, 50).toFixed(2)),
    p75: Number(percentile(values, 75).toFixed(2)),
    p95: Number(percentile(values, 95).toFixed(2)),
    max: Number(maxOf(values).toFixed(2)),
  };
}

function topPeaks(values, limit = 5) {
  return [...values]
    .sort((a, b) => b - a)
    .slice(0, limit)
    .map((value) => Number(value.toFixed(2)));
}

export function analyzeEditorTrace(tracePath) {
  const traceEvents = readTrace(tracePath);

  const targetTypes = ["keydown", "input", "paste", "click"];
  const eventDispatchByType = Object.fromEntries(
    targetTypes.map((type) => [type, []]),
  );
  const eventTimingByType = Object.fromEntries(
    targetTypes.map((type) => [type, []]),
  );

  const interactionLatencyEditorInputs = [];
  const interactionLatencyWithId = [];
  const longTasks = [];
  let totalRunTasks = 0;

  for (const event of traceEvents) {
    if (event.name === "EventDispatch" && event.ph === "X") {
      const type = event.args?.data?.type;
      if (targetTypes.includes(type) && typeof event.dur === "number") {
        eventDispatchByType[type].push(event.dur / 1000);
      }
    }

    if (event.name === "EventTiming") {
      const type = event.args?.data?.type;
      const duration = event.args?.data?.duration;
      const interactionId = event.args?.data?.interactionId ?? 0;
      if (targetTypes.includes(type) && typeof duration === "number") {
        eventTimingByType[type].push(duration);
        interactionLatencyEditorInputs.push(duration);
        if (interactionId > 0) interactionLatencyWithId.push(duration);
      }
    }

    if (event.name === "RunTask" && event.ph === "X") {
      totalRunTasks += 1;
      if (typeof event.dur === "number") {
        const durationMs = event.dur / 1000;
        if (durationMs >= 50) longTasks.push(durationMs);
      }
    }
  }

  return {
    source_trace: tracePath,
    generated_at_utc: new Date().toISOString(),
    units: {
      durations: "milliseconds",
      long_task_threshold_ms: 50,
    },
    event_dispatch: Object.fromEntries(
      targetTypes.map((type) => [type, stats(eventDispatchByType[type])]),
    ),
    event_timing: Object.fromEntries(
      targetTypes.map((type) => [type, stats(eventTimingByType[type])]),
    ),
    interaction_latency: {
      editor_inputs: stats(interactionLatencyEditorInputs),
      with_interaction_id: stats(interactionLatencyWithId),
    },
    long_tasks_ge_50ms: {
      total_run_tasks: totalRunTasks,
      stats: stats(longTasks),
      peaks_ms: topPeaks(longTasks),
    },
    peaks: {
      event_dispatch: Object.fromEntries(
        targetTypes.map((type) => [type, topPeaks(eventDispatchByType[type])]),
      ),
      event_timing: Object.fromEntries(
        targetTypes.map((type) => [type, topPeaks(eventTimingByType[type])]),
      ),
    },
  };
}

function main() {
  const { tracePath } = parseArgs(process.argv);
  const output = analyzeEditorTrace(tracePath);
  console.log(JSON.stringify(output, null, 2));
}

const scriptPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (scriptPath && import.meta.url === scriptPath) {
  main();
}
