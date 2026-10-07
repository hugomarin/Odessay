#!/usr/bin/env node
// ops:brief:lint (ODE-656) — is this issue dispatchable to BUILD?
//
//   npm run ops:brief:lint -- ODE-637 [ODE-636 …] [--require-contract] [--require-recon]
//
// Always: Reference docs present and non-empty, and any Architecture Contract
// that exists is complete (no missing or empty field). --require-contract: the
// issue activates Architecture (every Capability Proof does), so the contract
// must exist (issue-brief-schema.md). --require-recon: the "## Recon Pack"
// comment must exist (the planner did the area Recon). Run it during
// /wf-define (and by a coordinator before dispatching); /wf-build step 1 runs
// it again before moving the issue to In Progress. Rules live in
// scripts/lib/issue-brief-lint.mjs.

import { linearGraphQL } from "./lib/linear-client.mjs"
import { lintIssueBrief } from "./lib/issue-brief-lint.mjs"

const requireRecon = process.argv.includes("--require-recon")
const requireContract = process.argv.includes("--require-contract")
const identifiers = process.argv.slice(2).filter((arg) => /^[A-Z]+-\d+$/.test(arg))

if (identifiers.length === 0) {
  console.error("Usage: npm run ops:brief:lint -- ODE-123 [ODE-124 …] [--require-contract] [--require-recon]")
  process.exit(2)
}

let failed = false
for (const identifier of identifiers) {
  const data = await linearGraphQL(
    `query($id: String!) { issue(id: $id) { identifier description comments(first: 50) { nodes { body } } } }`,
    { variables: { id: identifier } },
  )
  const issue = data?.issue
  if (!issue) {
    console.error(`[ops:brief:lint] FAIL ${identifier}: issue not found.`)
    failed = true
    continue
  }
  const problems = lintIssueBrief(
    issue.description ?? "",
    issue.comments.nodes.map((comment) => comment.body ?? ""),
    { requireRecon, requireContract },
  )
  if (problems.length > 0) {
    failed = true
    console.error(`[ops:brief:lint] FAIL ${identifier}:`)
    for (const problem of problems) console.error(`  - ${problem}`)
  } else {
    console.log(`[ops:brief:lint] OK ${identifier}`)
  }
}

process.exit(failed ? 1 : 0)
