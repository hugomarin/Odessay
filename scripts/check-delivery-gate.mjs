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

function resolveBaseRef() {
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

const issueMatch = branch.match(/ODE-\d+/i);
if (!issueMatch) {
  fail(
    `Branch "${branch}" does not include an issue ID (expected ODE-XX in branch name).`,
  );
}

const issueId = issueMatch[0].toUpperCase();
const status = JSON.parse(readFileSync("workflow/status.json", "utf8"));
const entry = status.built.find((builtEntry) => builtEntry.issue === issueId);

if (!entry) {
  fail(
    `workflow/status.json is missing built[] entry for ${issueId}. Add it before moving to In Review.`,
  );
}

if (!entry.linear_url) {
  fail(`built[] entry for ${issueId} is missing linear_url.`);
}

if (!entry.date) {
  fail(`built[] entry for ${issueId} is missing date.`);
}

if (!entry.commit) {
  fail(`built[] entry for ${issueId} is missing commit.`);
}

if (!commitExists(entry.commit)) {
  fail(
    `built[] entry for ${issueId} references unknown commit "${entry.commit}".`,
  );
}

const baseRef = resolveBaseRef();
const mergeBase = execSync(`git merge-base HEAD ${baseRef}`, {
  encoding: "utf8",
}).trim();
const commitSubjects = execSync(`git log --pretty=%s ${mergeBase}..HEAD`, {
  encoding: "utf8",
})
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.startsWith("Merge "));

const commitsWithoutIssue = commitSubjects.filter(
  (subject) => !subject.includes(issueId),
);

if (commitsWithoutIssue.length > 0) {
  const listed = commitsWithoutIssue.map((subject) => `- ${subject}`).join("\n");
  fail(
    `Commits in this branch must reference ${issueId}. Fix commit messages:\n${listed}`,
  );
}

const perfTracePath = process.env.OPS_PERF_TRACE_PATH?.trim() ?? "";
if (perfTracePath) {
  const perfArgs = ["scripts/check-performance-gate.mjs", "--trace", perfTracePath];
  const perfReportPath = process.env.OPS_PERF_REPORT_PATH?.trim();
  const perfMetricsPath = process.env.OPS_PERF_METRICS_PATH?.trim();

  if (perfReportPath) {
    perfArgs.push("--report", perfReportPath);
  }

  if (perfMetricsPath) {
    perfArgs.push("--metrics", perfMetricsPath);
  }

  execFileSync("node", perfArgs, { stdio: "inherit" });
} else {
  console.log(
    "[ops:delivery:gate] Performance gate skipped (set OPS_PERF_TRACE_PATH to enforce perf budgets).",
  );
}

console.log(
  `[ops:delivery:gate] OK - ${issueId} has branch, commit traceability, and status.json entry.`,
);
