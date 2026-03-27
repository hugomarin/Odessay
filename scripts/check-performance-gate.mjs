#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { analyzeEditorTrace } from "./analyze-editor-trace.mjs";

const DEFAULT_BUDGETS_PATH = "workflow/perf-budgets.json";
const DEFAULT_REPORT_PATH = "artifacts/perf/perf-gate-report.json";
const DEFAULT_METRICS_PATH = "artifacts/perf/perf-metrics.json";

function fail(message) {
  console.error(`[ops:perf:gate] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    tracePath: process.env.OPS_PERF_TRACE_PATH?.trim() || "",
    budgetsPath: DEFAULT_BUDGETS_PATH,
    reportPath: process.env.OPS_PERF_REPORT_PATH?.trim() || DEFAULT_REPORT_PATH,
    metricsPath: process.env.OPS_PERF_METRICS_PATH?.trim() || DEFAULT_METRICS_PATH,
  };

  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (!arg.startsWith("--")) {
      fail(`Unknown argument "${arg}".`);
    }

    if (arg === "--trace") {
      if (!value) fail("Missing value for --trace.");
      options.tracePath = value;
      index += 1;
      continue;
    }

    if (arg === "--budgets") {
      if (!value) fail("Missing value for --budgets.");
      options.budgetsPath = value;
      index += 1;
      continue;
    }

    if (arg === "--report") {
      if (!value) fail("Missing value for --report.");
      options.reportPath = value;
      index += 1;
      continue;
    }

    if (arg === "--metrics") {
      if (!value) fail("Missing value for --metrics.");
      options.metricsPath = value;
      index += 1;
      continue;
    }

    fail(`Unknown option "${arg}".`);
  }

  if (!options.tracePath) {
    fail(
      "Trace path is required. Use --trace <path> or set OPS_PERF_TRACE_PATH.",
    );
  }

  return options;
}

function readBudgets(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed?.budgets || typeof parsed.budgets !== "object") {
    fail(`Invalid budgets file "${path}": missing budgets object.`);
  }
  return parsed;
}

function resolveEventMetric(section, metricKey, metrics) {
  const boundary = metricKey.lastIndexOf("_");
  if (boundary === -1) return null;

  const eventType = metricKey.slice(0, boundary);
  const stat = metricKey.slice(boundary + 1);
  const source =
    section === "event_dispatch_ms" ? metrics.event_dispatch : metrics.event_timing;

  const value = source?.[eventType]?.[stat];
  return typeof value === "number" ? value : null;
}

function resolveInteractionMetric(metricKey, metrics) {
  const boundary = metricKey.lastIndexOf("_");
  if (boundary === -1) return null;

  const bucket = metricKey.slice(0, boundary);
  const stat = metricKey.slice(boundary + 1);
  const value = metrics.interaction_latency?.[bucket]?.[stat];
  return typeof value === "number" ? value : null;
}

function resolveLongTaskMetric(metricKey, metrics) {
  const stats = metrics.long_tasks_ge_50ms?.stats;
  if (!stats || typeof stats !== "object") {
    if (metricKey === "count") return 0;
    if (metricKey === "max_ms" || metricKey === "max") return 0;
    return null;
  }

  if (typeof stats[metricKey] === "number") {
    return stats[metricKey];
  }

  if (metricKey.endsWith("_ms")) {
    const withoutUnit = metricKey.slice(0, -3);
    if (typeof stats[withoutUnit] === "number") {
      return stats[withoutUnit];
    }
  }

  return null;
}

function resolveMetricValue(section, metricKey, metrics) {
  if (section === "event_dispatch_ms" || section === "event_timing_ms") {
    return resolveEventMetric(section, metricKey, metrics);
  }

  if (section === "interaction_latency_ms") {
    return resolveInteractionMetric(metricKey, metrics);
  }

  if (section === "long_tasks_ge_50ms") {
    return resolveLongTaskMetric(metricKey, metrics);
  }

  return null;
}

function evaluateMetric(value, budget) {
  if (value === null) {
    return budget.required ? "missing" : "skip";
  }

  if (typeof budget.warn_lte !== "number" || typeof budget.fail_lte !== "number") {
    return budget.required ? "invalid-budget" : "skip";
  }

  if (value <= budget.warn_lte) return "pass";
  if (value <= budget.fail_lte) return "warn";
  return "fail";
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function main() {
  const options = parseArgs(process.argv);
  const budgets = readBudgets(options.budgetsPath);
  const metrics = analyzeEditorTrace(options.tracePath);

  const evaluations = [];
  for (const [section, sectionBudgets] of Object.entries(budgets.budgets)) {
    if (!sectionBudgets || typeof sectionBudgets !== "object") {
      continue;
    }

    for (const [metricKey, budget] of Object.entries(sectionBudgets)) {
      const value = resolveMetricValue(section, metricKey, metrics);
      const status = evaluateMetric(value, budget);

      evaluations.push({
        section,
        metric: metricKey,
        required: Boolean(budget.required),
        value,
        warn_lte: budget.warn_lte ?? null,
        fail_lte: budget.fail_lte ?? null,
        status,
        note: budget.note ?? null,
      });
    }
  }

  const requiredFailures = evaluations.filter(
    (entry) =>
      entry.required && (entry.status === "fail" || entry.status === "missing"),
  );
  const invalidBudgetEntries = evaluations.filter(
    (entry) => entry.status === "invalid-budget",
  );

  for (const evaluation of evaluations) {
    const valueLabel =
      typeof evaluation.value === "number" ? evaluation.value.toFixed(2) : "n/a";
    console.log(
      `[ops:perf:gate] ${evaluation.status.toUpperCase()} ${evaluation.section}.${evaluation.metric} = ${valueLabel} (warn<=${evaluation.warn_lte ?? "n/a"} fail<=${evaluation.fail_lte ?? "n/a"})`,
    );
  }

  const summary = {
    total: evaluations.length,
    pass: evaluations.filter((entry) => entry.status === "pass").length,
    warn: evaluations.filter((entry) => entry.status === "warn").length,
    fail: evaluations.filter((entry) => entry.status === "fail").length,
    missing: evaluations.filter((entry) => entry.status === "missing").length,
    skip: evaluations.filter((entry) => entry.status === "skip").length,
    invalid_budget: invalidBudgetEntries.length,
    required_failures: requiredFailures.length,
  };

  const report = {
    generated_at_utc: new Date().toISOString(),
    trace_path: options.tracePath,
    budgets_path: options.budgetsPath,
    budget_version: budgets.version ?? null,
    summary,
    evaluations,
  };

  writeJson(options.metricsPath, metrics);
  writeJson(options.reportPath, report);

  if (invalidBudgetEntries.length > 0) {
    fail("Invalid budget entries detected. Fix workflow/perf-budgets.json.");
  }

  if (requiredFailures.length > 0) {
    fail(
      `Performance gate failed: ${requiredFailures.length} required metric(s) exceeded budget or are missing.`,
    );
  }

  console.log(
    `[ops:perf:gate] OK - ${summary.pass} pass, ${summary.warn} warn, ${summary.skip} skip. Report: ${options.reportPath}`,
  );
}

main();
