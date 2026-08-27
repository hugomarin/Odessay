#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readBuilt, readStatus } from "./lib/workflow-ledger.mjs";
import { commitExists, resolveTraceabilityBase } from "./lib/traceability-refs.mjs";

function compareIssueId(a, b) {
  const aNum = Number.parseInt(a.replace("ODE-", ""), 10);
  const bNum = Number.parseInt(b.replace("ODE-", ""), 10);
  return aNum - bNum;
}

const strict = process.argv.includes("--strict");
const status = readStatus();
const built = readBuilt();
const ignoredIssues = new Set(
  Array.isArray(status.traceability_exceptions?.ignored_issue_ids)
    ? status.traceability_exceptions.ignored_issue_ids
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : typeof entry?.issue === "string"
              ? entry.issue
              : null,
        )
        .filter((issue) => typeof issue === "string")
    : [],
);
const builtIssues = built
  .map((entry) => entry.issue)
  .filter((issue) => typeof issue === "string");
const builtIssueSet = new Set(builtIssues);

const duplicates = builtIssues.filter(
  (issue, index) => builtIssues.indexOf(issue) !== index,
);

// Drift describes the accepted baseline, not the mutable branch currently
// named main and not the unmerged PR changes. CI pins this SHA at preflight.
const ref = resolveTraceabilityBase();

const subjects = execFileSync("git", ["log", "--pretty=%s", ref], {
  encoding: "utf8",
});

const gitIssueSet = new Set(
  subjects
    .split("\n")
    .filter((line) => !line.includes("review_rejected"))
    .flatMap((line) => [...line.matchAll(/\bODE-\d+\b/g)])
    .map((match) => match[0])
    .filter((issue) => !ignoredIssues.has(issue)),
);

const missingInStatus = [...gitIssueSet]
  .filter((issue) => !builtIssueSet.has(issue))
  .sort(compareIssueId);

const missingCommitRefs = built
  .filter((entry) => entry.commit)
  .filter((entry) => !commitExists(entry.commit))
  .map((entry) => ({
    issue: entry.issue ?? "N/A",
    commit: entry.commit,
  }));

const builtDates = built
  .map((entry) => entry.date)
  .filter((date) => typeof date === "string")
  .sort();
const latestBuiltDate = builtDates.at(-1);
const staleLastUpdated =
  typeof latestBuiltDate === "string" &&
  typeof status.last_updated === "string" &&
  status.last_updated < latestBuiltDate;

const hasProblems =
  duplicates.length > 0 ||
  missingInStatus.length > 0 ||
  missingCommitRefs.length > 0 ||
  staleLastUpdated;

if (!hasProblems) {
  console.log(
    `[ops:status:drift] OK - ${builtIssueSet.size} issues in the built ledger aligned against ${ref}.`,
  );
  if (ignoredIssues.size > 0) {
    console.log(
      `[ops:status:drift] Ignoring historical traceability exceptions: ${[...ignoredIssues]
        .sort(compareIssueId)
        .join(", ")}.`,
    );
  }
  process.exit(0);
}

if (duplicates.length > 0) {
  const formatted = [...new Set(duplicates)].sort(compareIssueId).join(", ");
  console.error(
    `[ops:status:drift] Duplicated issues in the built ledger: ${formatted}`,
  );
}

if (missingInStatus.length > 0) {
  console.error(
    `[ops:status:drift] Missing issues in workflow/built.jsonl: ${missingInStatus.join(", ")}`,
  );
}

if (missingCommitRefs.length > 0) {
  for (const entry of missingCommitRefs) {
    console.error(
      `[ops:status:drift] Commit reference not found for ${entry.issue}: ${entry.commit}`,
    );
  }
}

if (staleLastUpdated) {
  console.error(
    `[ops:status:drift] last_updated (${status.last_updated}) is older than latest built entry (${latestBuiltDate}).`,
  );
}

if (strict) {
  process.exit(1);
}

console.log("[ops:status:drift] WARN mode: reporting only (use --strict to fail).");
