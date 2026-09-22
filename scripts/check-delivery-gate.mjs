#!/usr/bin/env node

// Thin wrapper kept for backward compatibility with docs/workflows that
// still say `ops:delivery:gate`. Traceability now lives in its own script
// (scripts/check-traceability-gate.mjs, `ops:traceability:gate`) with no
// performance dependency — CI calls that one directly. This wrapper adds
// back the optional performance gate for local/manual use: `wf-build`/
// `wf-ship` still invoke this one so `OPS_PERF_TRACE_PATH` keeps working
// exactly as before when a Performance Architecture Contract selected it.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Resolved relative to this file, not process.cwd() — this script (and its
// tests) can run with a working directory other than the repo root.
const traceabilityGatePath = join(dirname(fileURLToPath(import.meta.url)), "check-traceability-gate.mjs");

try {
  execFileSync("node", [traceabilityGatePath], { stdio: "inherit" });
} catch (error) {
  process.exit(error.status ?? 1);
}

const perfTracePath = process.env.OPS_PERF_TRACE_PATH?.trim() ?? "";
if (perfTracePath) {
  const perfArgs = ["scripts/check-performance-gate.mjs", "--trace", perfTracePath];
  const perfReportPath = process.env.OPS_PERF_REPORT_PATH?.trim();
  const perfMetricsPath = process.env.OPS_PERF_METRICS_PATH?.trim();
  const perfBudgetsPath = process.env.OPS_PERF_BUDGETS_PATH?.trim();

  if (perfReportPath) {
    perfArgs.push("--report", perfReportPath);
  }

  if (perfMetricsPath) {
    perfArgs.push("--metrics", perfMetricsPath);
  }

  if (perfBudgetsPath) {
    perfArgs.push("--budgets", perfBudgetsPath);
  }

  try {
    execFileSync("node", perfArgs, { stdio: "inherit" });
  } catch (error) {
    process.exit(error.status ?? 1);
  }
} else {
  console.log(
    "[ops:delivery:gate] Performance gate skipped (set OPS_PERF_TRACE_PATH to enforce perf budgets).",
  );
}

console.log("[ops:delivery:gate] OK - traceability gate passed.");
