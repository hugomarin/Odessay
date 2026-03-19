#!/usr/bin/env node

import { execSync } from "node:child_process";
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
const status = JSON.parse(readFileSync("docs/ops/status.json", "utf8"));
const entry = status.built.find((builtEntry) => builtEntry.issue === issueId);

if (!entry) {
  fail(
    `docs/ops/status.json is missing built[] entry for ${issueId}. Add it before moving to In Review.`,
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

const baseRef = "main";
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

console.log(
  `[ops:delivery:gate] OK - ${issueId} has branch, commit traceability, and status.json entry.`,
);
