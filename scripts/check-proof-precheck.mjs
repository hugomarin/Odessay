#!/usr/bin/env node
// ops:proof:precheck (ODE-656) — mechanical checks a capability-proof branch
// must pass before its PR opens (workflow.md /wf-build step 7) and that CI
// re-runs in the Traceability job. Rules live in scripts/lib/proof-precheck.mjs.
//
// Range: the branch's own commits, merges excluded.
//   CI:    TRACEABILITY_BASE_SHA..TRACEABILITY_PR_HEAD_SHA (pinned by process-checks.yml)
//   local: origin/main..HEAD, or --base <ref> --head <ref>

import { execFileSync } from "node:child_process"
import {
  CAPABILITY_MAP_PATH,
  checkCapabilityMap,
  checkCommit,
  diffLines,
  isTestPath,
} from "./lib/proof-precheck.mjs"

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

function resolveRange() {
  const base = argValue("--base") ?? process.env.TRACEABILITY_BASE_SHA?.trim() ?? "origin/main"
  const head = argValue("--head") ?? process.env.TRACEABILITY_PR_HEAD_SHA?.trim() ?? "HEAD"
  return { base, head }
}

const { base, head } = resolveRange()
const shas = git("rev-list", "--no-merges", "--reverse", `${base}..${head}`)
  .split("\n")
  .filter(Boolean)

const violations = []
for (const sha of shas) {
  const subject = git("log", "-1", "--format=%s", sha).trim()
  const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha)
    .split("\n")
    .filter(Boolean)
  const testPatches = {}
  for (const file of files.filter(isTestPath)) {
    testPatches[file] = git("show", "--format=", "-U0", sha, "--", file)
  }
  violations.push(...checkCommit({ sha, subject, files, testPatches }))
}

const mapPatch = git("diff", "-U0", `${base}...${head}`, "--", CAPABILITY_MAP_PATH)
if (mapPatch.trim()) {
  const changedLines = new Set(diffLines(mapPatch).added)
  const mapText = git("show", `${head}:${CAPABILITY_MAP_PATH}`)
  violations.push(...checkCapabilityMap(mapText, changedLines))
}

if (violations.length > 0) {
  console.error(`[ops:proof:precheck] FAIL - ${violations.length} violation(s) in ${base}..${head}:`)
  for (const violation of violations) {
    console.error(`  ${violation.sha} [${violation.rule}] ${violation.detail}`)
  }
  process.exit(1)
}

console.log(
  `[ops:proof:precheck] OK - ${shas.length} commit(s) in ${base}..${head}; commit order and capability map row format are consistent.`,
)
