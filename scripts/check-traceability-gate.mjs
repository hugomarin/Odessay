#!/usr/bin/env node

// Single responsibility: branch/PR/ODE traceability, commit traceability, and
// the infra/process exemption. No performance concerns here — see
// scripts/check-performance-gate.mjs for that, invoked independently (or via
// the scripts/check-delivery-gate.mjs wrapper) instead of being bundled into
// this gate. This lets traceability fail in seconds, before anything that
// needs npm ci, a browser, or a build.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveTraceabilityRange } from "./lib/traceability-refs.mjs";

function fail(message) {
  console.error(`[ops:traceability:gate] ${message}`);
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

// Infra/process PRs (harness, CI, skills/roles, ops scripts) don't touch a
// feature with its own issue, so ODE-XX would be filler. The exemption only
// holds when BOTH are true: the PR self-identifies as infra/process (branch
// prefix or PR label — name alone isn't proof of content) AND every changed
// file is inside the explicit infra/process allowlist below. Any product
// code outside that allowlist (app/**, components/**, lib/**, src-tauri/**,
// etc.) puts the ODE-XX requirement right back.
const INFRA_PROCESS_BRANCH_PREFIXES = ["infra/", "process/"];
const INFRA_PROCESS_LABELS = new Set(["infra", "process"]);
const INFRA_PROCESS_PATH_PATTERNS = [
  /^\.github\//,
  /^\.agents\//,
  /^\.claude\//,
  /^architecture\//,
  /^tests\/architecture\//,
  /^docs\//,
  /^workflow\//,
  /^README\.md$/,
  /^AGENTS\.md$/,
  /\/AGENTS\.md$/,
  /^scripts\/lib\//,
  /^scripts\/check-process-sync\.mjs$/,
  /^scripts\/check-traceability-refs\.mjs$/,
  /^scripts\/check-traceability-gate\.mjs$/,
  /^scripts\/check-status-drift\.mjs$/,
  /^scripts\/check-delivery-gate\.mjs$/,
  /^scripts\/check-performance-gate\.mjs$/,
  /^scripts\/check-network-budget\.mjs$/,
  /^scripts\/validate-workflow-json\.mjs$/,
  /^scripts\/workflow-ledger\.mjs$/,
];

function pullRequestLabels() {
  const eventPath = process.env.GITHUB_EVENT_PATH?.trim();
  if (!eventPath) return [];
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    const labels = event?.pull_request?.labels;
    return Array.isArray(labels)
      ? labels.map((label) => String(label?.name ?? "").toLowerCase())
      : [];
  } catch {
    return [];
  }
}

const isInfraProcessCategory =
  INFRA_PROCESS_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix)) ||
  pullRequestLabels().some((label) => INFRA_PROCESS_LABELS.has(label));

function changedFiles() {
  const mergeBase = execFileSync("git", ["merge-base", range.head, range.base], {
    encoding: "utf8",
  }).trim();
  return execFileSync("git", ["diff", "--name-only", `${mergeBase}..${range.head}`], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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

let infraProcessExempt = false;
if (issueIds.length === 0) {
  if (!isInfraProcessCategory) {
    fail(
      `Branch "${branch}" does not include an issue ID (expected ODE-XX in branch name).`,
    );
  }

  const outOfScope = changedFiles().filter(
    (filePath) => !INFRA_PROCESS_PATH_PATTERNS.some((pattern) => pattern.test(filePath)),
  );
  if (outOfScope.length > 0) {
    const listed = outOfScope.map((filePath) => `- ${filePath}`).join("\n");
    fail(
      `Branch "${branch}" is marked infra/process (branch prefix or PR label) but the diff touches paths outside the infra/process allowlist:\n${listed}\nAdd an ODE-XX issue id instead, or scope this PR to infra/process paths only.`,
    );
  }

  infraProcessExempt = true;
  console.log(
    `[ops:traceability:gate] OK - infra/process category, diff limited to the infra/process allowlist. ODE-XX not required.`,
  );
}
const baseRef = range.base;
const headRef = range.head;
console.log(`[ops:traceability:gate] Comparing ${baseRef}..${headRef}.`);

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
        "User-Agent": "odessay-traceability-gate",
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
// Infra/process exemptions have no issueIds to check commits against, so
// this whole check is meaningless (and would falsely flag every commit) once
// exempt — skip it entirely in that case.
if (!infraProcessExempt) {
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
}

if (!infraProcessExempt) {
  console.log(
    `[ops:traceability:gate] OK - ${issueIds.join(", ")} have branch and commit traceability.`,
  );
}
