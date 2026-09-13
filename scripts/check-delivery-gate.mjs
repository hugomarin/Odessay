#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolveTraceabilityRange } from "./lib/traceability-refs.mjs";
import { githubCompareCommitSubjects } from "./lib/traceability-github.mjs";

function fail(message) {
  console.error(`[ops:delivery:gate] ${message}`);
  process.exit(1);
}

const range = resolveTraceabilityRange();

const branch =
  process.env.GITHUB_HEAD_REF?.trim() ||
  execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
  }).trim();

if (branch === "main" || branch === "HEAD") {
  fail(`Run this gate from an issue branch, current branch is "${branch}".`);
}

function extractIssueIds(branchName) {
  const singleMatch = branchName.match(/ODE-(\d+)/i);
  if (!singleMatch) {
    return [];
  }

  const startIndex = singleMatch.index ?? branchName.indexOf(singleMatch[0]);
  const sequence = branchName.slice(startIndex);
  const numbers = sequence
    .replace(/^ODE-/i, "")
    .split("-")
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part));

  return Array.from(new Set(numbers.map((num) => `ODE-${num}`)));
}

const pinnedIssueIds = (process.env.TRACEABILITY_ISSUE_IDS ?? "")
  .split(",")
  .map((issue) => issue.trim().toUpperCase())
  .filter((issue) => /^ODE-\d+$/.test(issue));
const issueIds = Array.from(new Set([...extractIssueIds(branch), ...pinnedIssueIds]));
if (issueIds.length === 0) {
  fail(
    `Branch "${branch}" does not include an issue ID (expected ODE-XX in branch name).`,
  );
}
const baseRef = range.base;
const headRef = range.head;
const prHead = process.env.TRACEABILITY_PR_HEAD_SHA?.trim() ?? "";
const prBranchPoint = process.env.TRACEABILITY_PR_BRANCH_POINT_SHA?.trim() ?? "";
const commitBaseRef =
  range.source === "pinned-environment" && prHead && prBranchPoint
    ? prBranchPoint
    : baseRef;
const commitHeadRef =
  range.source === "pinned-environment" && prHead && prBranchPoint
    ? prHead
    : headRef;
console.log(
  `[ops:delivery:gate] Comparing ${commitBaseRef}..${commitHeadRef} for commit traceability (immutable range ${baseRef}..${headRef}).`,
);
// Runner-side diagnostics: if CI's graph evaluation disagrees with every
// local clone, these numbers make it visible instead of a mystery list.
const mergeBaseCheck = execFileSync(
  "git",
  ["merge-base", commitBaseRef, commitHeadRef],
  { encoding: "utf8" },
).trim();
const rangeCount = execFileSync(
  "git",
  ["rev-list", "--count", `${commitBaseRef}..${commitHeadRef}`],
  { encoding: "utf8" },
).trim();
console.log(
  `[ops:delivery:gate] Diagnostics: merge-base(${commitBaseRef.slice(0, 8)}, ${commitHeadRef.slice(0, 8)})=${mergeBaseCheck.slice(0, 8)} | rev-list --count=${rangeCount}`,
);
async function githubPullRequestCommitSubjects() {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (process.env.GITHUB_ACTIONS !== "true" || !repository) {
    return null;
  }
  try {
    const subjects = await githubCompareCommitSubjects({
      repository,
      base: commitBaseRef,
      head: commitHeadRef,
      token: process.env.GITHUB_TOKEN?.trim(),
    });
    console.log(
      `[ops:delivery:gate] Using GitHub's immutable comparison (${subjects.length} commits) for CI traceability.`,
    );
    return subjects;
  } catch (error) {
    fail(error instanceof Error ? error.message : "GitHub compare API failed.");
  }
}

// CI evaluates the pinned branch-point..PR-head range through GitHub's
// immutable comparison API. This avoids trusting a synthetic runner checkout
// whose revision walk may be inconsistent after a force-push. Local runs use
// the equivalent git range.
const commitSubjects = (
  (await githubPullRequestCommitSubjects()) ??
  execFileSync("git", ["log", "--pretty=%s", `${commitBaseRef}..${commitHeadRef}`], {
    encoding: "utf8",
  }).split("\n")
)
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.startsWith("Merge "));

const commitsWithoutIssue = commitSubjects.filter(
  (subject) => !issueIds.some((id) => subject.includes(id)),
);

if (commitsWithoutIssue.length > 0) {
  const listed = commitsWithoutIssue.map((subject) => `- ${subject}`).join("\n");
  fail(
    `Commits in this branch must reference one of ${issueIds.join(", ")}. Fix commit messages:\n${listed}`,
  );
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

  execFileSync("node", perfArgs, { stdio: "inherit" });
} else {
  console.log(
    "[ops:delivery:gate] Performance gate skipped (set OPS_PERF_TRACE_PATH to enforce perf budgets).",
  );
}

console.log(
  // El ledger lo verifica `ops:status:drift`, no este gate: acá solo se
  // comprueba rama y trazabilidad de commits.
  `[ops:delivery:gate] OK - ${issueIds.join(", ")} have branch and commit traceability.`,
);
