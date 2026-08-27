#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolveTraceabilityRange } from "./lib/traceability-refs.mjs";

const PROCESS_FILES = [
  "workflow/workflow.md",
  ".agents/skills/skill-product-manager/SKILL.md",
  ".agents/skills/skill-code-review/SKILL.md",
];

const range = resolveTraceabilityRange();
const mergeBase = execFileSync("git", ["merge-base", range.head, range.base], {
  encoding: "utf8",
}).trim();

const changedFiles = execFileSync("git", ["diff", "--name-only", `${mergeBase}..${range.head}`], {
  encoding: "utf8",
})
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const touchedProcessFiles = PROCESS_FILES.filter((file) =>
  changedFiles.includes(file),
);

if (touchedProcessFiles.length === 0) {
  console.log(
    `[ops:process:sync] OK - no process files changed in this PR (${range.source}: ${mergeBase}..${range.head}).`,
  );
  process.exit(0);
}

if (touchedProcessFiles.length !== PROCESS_FILES.length) {
  const missing = PROCESS_FILES.filter((file) => !touchedProcessFiles.includes(file));
  console.error(
    "[ops:process:sync] FAIL - process change must update all 3 files together.",
  );
  console.error(`[ops:process:sync] touched: ${touchedProcessFiles.join(", ")}`);
  console.error(`[ops:process:sync] missing: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(
  "[ops:process:sync] OK - process files updated together (workflow + PM + Code Review).",
);
