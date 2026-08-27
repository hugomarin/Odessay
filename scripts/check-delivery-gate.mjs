#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolveTraceabilityRange } from "./lib/traceability-refs.mjs";

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
console.log(`[ops:delivery:gate] Comparing ${baseRef}..${headRef}.`);
async function githubPullRequestCommitSubjects() {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    !repository ||
    range.source !== "pull-request-event"
  ) {
    return null;
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/compare/${baseRef}...${headRef}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "odessay-delivery-gate",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    },
  );
  if (!response.ok) {
    fail(`GitHub compare API failed with ${response.status}.`);
  }
  const comparison = await response.json();
  if (!Array.isArray(comparison.commits)) {
    fail("GitHub compare API returned no commit list.");
  }
  return comparison.commits.map((entry) => entry.commit.message.split("\n")[0]);
}

// A pinned CI merge range is intentionally evaluated from local immutable
// objects. Event-only fallback may use GitHub compare; local runs use git.
const commitSubjects = (
  (await githubPullRequestCommitSubjects()) ??
  execFileSync("git", ["log", "--pretty=%s", `${baseRef}..${headRef}`], {
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
