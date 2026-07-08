#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_BUDGETS_PATH = "workflow/perf-budgets-network.json";
const DEFAULT_REPORT_PATH = "artifacts/perf/network-gate-report.json";
const DEFAULT_METRICS_PATH = "artifacts/perf/network-metrics.json";

function fail(message) {
  console.error(`[ops:network:gate] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    harPath: process.env.OPS_NETWORK_HAR_PATH?.trim() || "",
    budgetsPath:
      process.env.OPS_NETWORK_BUDGETS_PATH?.trim() || DEFAULT_BUDGETS_PATH,
    reportPath:
      process.env.OPS_NETWORK_REPORT_PATH?.trim() || DEFAULT_REPORT_PATH,
    metricsPath:
      process.env.OPS_NETWORK_METRICS_PATH?.trim() || DEFAULT_METRICS_PATH,
  };

  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (!arg.startsWith("--")) {
      fail(`Unknown argument "${arg}".`);
    }

    if (arg === "--har") {
      if (!value) fail("Missing value for --har.");
      options.harPath = value;
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

  if (!options.harPath) {
    fail("HAR path is required. Use --har <path> or set OPS_NETWORK_HAR_PATH.");
  }

  return options;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} file "${path}": ${error.message}`);
  }
}

function readBudgets(path) {
  const parsed = readJson(path, "budgets");
  if (!parsed?.budgets || typeof parsed.budgets !== "object") {
    fail(`Invalid budgets file "${path}": missing budgets object.`);
  }
  return parsed;
}

function readHar(path) {
  const parsed = readJson(path, "HAR");
  const entries = parsed?.log?.entries;
  if (!Array.isArray(entries)) {
    fail(`Invalid HAR file "${path}": missing log.entries array.`);
  }
  return entries;
}

function startedAtMs(entry) {
  const started = Date.parse(entry?.startedDateTime ?? "");
  return Number.isFinite(started) ? started : null;
}

function requestMethod(entry) {
  return String(entry?.request?.method ?? "GET").toUpperCase();
}

function requestUrl(entry) {
  return String(entry?.request?.url ?? "");
}

function requestIdentity(entry) {
  return `${requestMethod(entry)} ${requestUrl(entry)}`;
}

function transferBytes(entry) {
  const response = entry?.response ?? {};
  const candidates = [
    response._transferSize,
    response._encodedBodySize,
    response.bodySize,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && candidate > 0) {
      return candidate;
    }
  }

  const bodySize = typeof response.bodySize === "number" ? response.bodySize : 0;
  const headersSize =
    typeof response.headersSize === "number" ? response.headersSize : 0;
  return Math.max(0, bodySize) + Math.max(0, headersSize);
}

function includesPath(url, path) {
  return url.includes(path);
}

function isListenerRequest(entry) {
  const haystack = [
    requestUrl(entry),
    entry?.request?.postData?.text,
    entry?.request?.postData?.mimeType,
  ]
    .filter(Boolean)
    .join(" ");
  return /plugin:event\|(?:listen|unlisten)/.test(haystack);
}

function isListenRequest(entry) {
  const haystack = [requestUrl(entry), entry?.request?.postData?.text]
    .filter(Boolean)
    .join(" ");
  return /plugin:event\|listen/.test(haystack);
}

function isUnlistenRequest(entry) {
  const haystack = [requestUrl(entry), entry?.request?.postData?.text]
    .filter(Boolean)
    .join(" ");
  return /plugin:event\|unlisten/.test(haystack);
}

function analyzeNetworkHar(entries, budgets) {
  const startupWindowMs = budgets.capture?.startup_window_ms ?? 5000;
  const timedEntries = entries
    .map((entry, index) => ({ entry, index, startedAt: startedAtMs(entry) }))
    .filter((item) => item.startedAt !== null)
    .sort((a, b) => a.startedAt - b.startedAt || a.index - b.index);

  if (timedEntries.length === 0) {
    fail("HAR contains no entries with valid startedDateTime values.");
  }

  const firstStartedAt = timedEntries[0].startedAt;
  const startupCutoff = firstStartedAt + startupWindowMs;
  const startupEntries = timedEntries
    .filter((item) => item.startedAt <= startupCutoff)
    .map((item) => item.entry);
  const navigationEntries = timedEntries
    .filter((item) => item.startedAt > startupCutoff)
    .map((item) => item.entry);

  const duplicateCounts = new Map();
  for (const entry of startupEntries) {
    const identity = requestIdentity(entry);
    duplicateCounts.set(identity, (duplicateCounts.get(identity) ?? 0) + 1);
  }

  const duplicateGroups = Array.from(duplicateCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([identity, count]) => ({
      identity,
      count,
      duplicates: count - 1,
    }));

  const metrics = {
    capture: {
      startup_window_ms: startupWindowMs,
      first_started_at_utc: new Date(firstStartedAt).toISOString(),
      startup_cutoff_utc: new Date(startupCutoff).toISOString(),
      total_har_entries: timedEntries.length,
    },
    startup: {
      total_requests: startupEntries.length,
      transfer_bytes: startupEntries.reduce(
        (total, entry) => total + transferBytes(entry),
        0,
      ),
      duplicate_identical_requests: duplicateGroups.reduce(
        (total, group) => total + group.duplicates,
        0,
      ),
      duplicate_groups: duplicateGroups.length,
      writings_requests: startupEntries.filter((entry) =>
        includesPath(requestUrl(entry), "/writings"),
      ).length,
      collections_requests: startupEntries.filter((entry) =>
        includesPath(requestUrl(entry), "/collections"),
      ).length,
      writing_collections_requests: startupEntries.filter((entry) =>
        includesPath(requestUrl(entry), "/writing_collections"),
      ).length,
    },
    navigation: {
      listener_churn_requests: navigationEntries.filter(isListenerRequest).length,
      listen_requests: navigationEntries.filter(isListenRequest).length,
      unlisten_requests: navigationEntries.filter(isUnlistenRequest).length,
    },
    duplicate_groups: duplicateGroups,
  };

  return metrics;
}

function resolveMetricValue(section, metricKey, metrics) {
  const sectionMetrics = metrics[section];
  if (!sectionMetrics || typeof sectionMetrics !== "object") {
    return null;
  }

  const value = sectionMetrics[metricKey];
  return typeof value === "number" ? value : null;
}

function evaluateMetric(value, budget) {
  if (value === null) {
    return budget.required ? "missing" : "skip";
  }

  if (typeof budget.warn_lte !== "number" || typeof budget.fail_lte !== "number") {
    return budget.required ? "invalid-budget" : "skip";
  }

  const hardFailLte =
    typeof budget.grace_lte === "number" ? budget.grace_lte : budget.fail_lte;

  if (value <= budget.warn_lte) return "pass";
  if (value <= hardFailLte) return "warn";
  return "fail";
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function main() {
  const options = parseArgs(process.argv);
  const budgets = readBudgets(options.budgetsPath);
  const entries = readHar(options.harPath);
  const metrics = analyzeNetworkHar(entries, budgets);

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
        grace_lte: budget.grace_lte ?? null,
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
      typeof evaluation.value === "number" ? String(evaluation.value) : "n/a";
    const failThreshold = evaluation.grace_lte ?? evaluation.fail_lte;
    console.log(
      `[ops:network:gate] ${evaluation.status.toUpperCase()} ${evaluation.section}.${evaluation.metric} = ${valueLabel} (warn<=${evaluation.warn_lte ?? "n/a"} fail<=${failThreshold ?? "n/a"})`,
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
    har_path: options.harPath,
    budgets_path: options.budgetsPath,
    budget_version: budgets.version ?? null,
    summary,
    evaluations,
    metrics,
  };

  writeJson(options.metricsPath, metrics);
  writeJson(options.reportPath, report);

  if (invalidBudgetEntries.length > 0) {
    fail("Invalid budget entries detected. Fix workflow/perf-budgets-network.json.");
  }

  if (requiredFailures.length > 0) {
    fail(
      `Network gate failed: ${requiredFailures.length} required metric(s) exceeded budget or are missing.`,
    );
  }

  console.log(
    `[ops:network:gate] OK - ${summary.pass} pass, ${summary.warn} warn, ${summary.skip} skip. Report: ${options.reportPath}`,
  );
}

main();
