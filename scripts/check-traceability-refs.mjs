#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { commitExists, resolveTraceabilityRange } from "./lib/traceability-refs.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`[ops:traceability:refs] ${message}`);
  process.exit(1);
}

let range;
try {
  range = resolveTraceabilityRange();
} catch (error) {
  fail(error instanceof Error ? error.message : "Could not resolve traceability range.");
}

const currentHead = git(["rev-parse", "HEAD"]);
const prHead = process.env.TRACEABILITY_PR_HEAD_SHA?.trim() ?? "";
const mergeSha = process.env.TRACEABILITY_MERGE_SHA?.trim() ?? "";
const pinnedMergeBase = process.env.TRACEABILITY_MERGE_BASE_SHA?.trim() ?? "";

for (const [label, commit] of [
  ["base", range.base],
  ["head", range.head],
  ["pr-head", prHead],
  ["merge", mergeSha],
  ["merge-base", pinnedMergeBase],
]) {
  if (commit && !commitExists(commit)) fail(`${label} commit is missing: ${commit}`);
}

if (mergeSha && currentHead !== mergeSha) {
  fail(`HEAD moved after preflight: expected ${mergeSha}, received ${currentHead}.`);
}
if (range.source === "pinned-environment" && currentHead !== range.head) {
  fail(`Pinned head differs from checkout: ${range.head} != ${currentHead}.`);
}

const prBranchPoint = git(["merge-base", range.eventBase || range.base, prHead || range.head]);
console.log(`[ops:traceability:refs] source=${range.source}`);
console.log(`[ops:traceability:refs] HEAD=${currentHead}`);
console.log(`[ops:traceability:refs] base=${range.base}`);
console.log(`[ops:traceability:refs] pr_head=${prHead || "n/a"}`);
console.log(`[ops:traceability:refs] merge=${mergeSha || range.head}`);
console.log(`[ops:traceability:refs] merge_base=${range.base}`);
console.log(`[ops:traceability:refs] pr_branch_point=${prBranchPoint}`);
console.log("[ops:traceability:refs] OK - immutable traceability range is available.");
