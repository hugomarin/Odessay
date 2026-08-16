#!/usr/bin/env node

import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`[ops:delivery:gate] ${message}`);
  process.exit(1);
}

function commitExists(commit) {
  try {
    execSync(`git cat-file -e ${commit}^{commit}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasRef(ref) {
  try {
    execSync(`git rev-parse --verify ${ref}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pullRequestShas() {
  const eventPath = process.env.GITHUB_EVENT_PATH?.trim();
  if (!eventPath) return { base: null, head: null };
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    const validSha = (sha) =>
      typeof sha === "string" && commitExists(sha) ? sha : null;
    return {
      base: validSha(event?.pull_request?.base?.sha),
      head: validSha(event?.pull_request?.head?.sha),
    };
  } catch {
    return { base: null, head: null };
  }
}

const eventPullRequestShas = pullRequestShas();

function resolveBaseRef() {
  // A PR event carries the immutable base SHA used to calculate the diff. Prefer
  // it over local branch names: actions/checkout may leave a stale or ambiguous
  // `main` ref even with full history, causing the gate to inspect repository
  // history that is already part of the PR base.
  const eventBaseSha = eventPullRequestShas.base;
  if (eventBaseSha) return eventBaseSha;

  const fromCi = process.env.GITHUB_BASE_REF?.trim();
  if (fromCi) {
    const remoteRef = `origin/${fromCi}`;
    if (hasRef(remoteRef)) return remoteRef;
    if (hasRef(fromCi)) return fromCi;
  }
  if (hasRef("origin/main")) return "origin/main";
  if (hasRef("main")) return "main";
  return "HEAD";
}

const branch =
  process.env.GITHUB_HEAD_REF?.trim() ||
  execSync("git rev-parse --abbrev-ref HEAD", {
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

const issueIds = extractIssueIds(branch);
if (issueIds.length === 0) {
  fail(
    `Branch "${branch}" does not include an issue ID (expected ODE-XX in branch name).`,
  );
}
const baseRef = resolveBaseRef();
const headRef = eventPullRequestShas.head ?? "HEAD";
console.log(`[ops:delivery:gate] Comparing ${baseRef}..${headRef}.`);
async function githubPullRequestCommitSubjects() {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    !repository ||
    !eventPullRequestShas.base ||
    !eventPullRequestShas.head
  ) {
    return null;
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/compare/${eventPullRequestShas.base}...${eventPullRequestShas.head}`,
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

// In CI, GitHub's compare endpoint is the authority for the PR commit set. This
// avoids runner-specific reachability differences after a branch incorporates
// main. Local runs keep the fast, offline Git range.
const commitSubjects = (
  (await githubPullRequestCommitSubjects()) ??
  execSync(`git log --pretty=%s ${baseRef}..${headRef}`, {
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
