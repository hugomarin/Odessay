import { readFileSync, writeFileSync } from "fs";

const path = "workflow/status.json";
const data = JSON.parse(readFileSync(path, "utf8"));

data.last_updated = "2026-05-30";

// Update phase_plan notes
let notes = data.phase_plan.notes;
notes = notes.replace(
  "Pendientes: ODE-211 (DoD validation harness), ODE-212 (perf-budgets grace_lte), ODE-214 (format context menu right-click).",
  "Pendientes: ODE-211 (DoD validation harness). Completados: ODE-212 (perf-budgets grace_lte), ODE-214 (native macOS menu bar)."
);
data.phase_plan.notes = notes;

// Add built entry
const builtEntry = {
  what: "Add grace_lte (+20% over fail_lte) to all required metrics in workflow/perf-budgets.json that lacked a grace band. Prevents CI noise from blocking delivery on marginal overruns (precedent: ODE-209 rejected for 3.4ms overrun on keydown_p95). 12 metrics updated across event_dispatch_ms, event_timing_ms, interaction_latency_ms, and long_tasks_ge_50ms. Gate script already supported grace_lte via hardFailLte = grace_lte ?? fail_lte.",
  phase: "Fase 6 — Desktop Local-First Runtime",
  issue: "ODE-212",
  linear_url: "https://linear.app/z9ne/issue/ODE-212/perf-budgets-anadir-grace-lte-del-20percent-sobre-fail-lte-en-metricas",
  pr_url: "https://github.com/hugomarin/Odessay/pull/205",
  commit: "fc8c185",
  date: "2026-05-30",
  notes: "Score: 10/10. Zero code risk — config-only change to perf budgets. All validations: typecheck PASS, lint PASS (pre-existing warnings only), 580 tests PASS, delivery gate PASS, Vercel SUCCESS, traceability SUCCESS. Simulated keydown_p95=93ms → WARN (grace_lte=108), confirming acceptance criteria. Architecture Contract: not applicable (no runtime boundary touched). Performance Contract: not required (change reduces false-positive gate failures, does not alter runtime performance). Clean first-round approval."
};

data.built.unshift(builtEntry);

writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
console.log("status.json updated");
